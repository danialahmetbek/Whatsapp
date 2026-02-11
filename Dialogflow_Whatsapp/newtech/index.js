import functions from '@google-cloud/functions-framework'; // Imports the framework for HTTP-triggered Cloud Functions
import axios from 'axios'; // Used for making HTTP requests (to the Facebook Graph API)
import { Storage } from '@google-cloud/storage'; // Google Cloud Storage client library
import fs from 'fs'; // Node.js file system module
import path from 'path'; // Utility for working with file and directory paths


// Facebook Graph API configuration (values taken from environment variables)
const apiUrl = `https://graph.facebook.com/v22.0/${process.env.PHONE_ID}/messages`; // Defines WhatsApp API endpoint
const accessToken = process.env.GRAPH_API_TOKEN; // Graph API access token (keep secret)
const phone_number = process.env.PHONE_NUMBER; // WhatsApp business phone number used as sender


// Defines an HTTP Cloud Function named "newTech"
functions.http('newTech', async (req, res) => {
    try {
        // Retrieves session identifier from query parameter
        const sessionId = req.query['X-SESSION'];
        
        // Downloads and reads user sessions stored in Cloud Storage
        const obj = await readSessions();
        const phoneNumber = Object.keys(obj).find(key => obj[key] === sessionId); // Finds the phone that matches this session

        // Extracts question data from request body
        const {question} = req.body;

        // Prepares WhatsApp API message payload using a predefined template
        const messageData = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone_number,
            type: "template",
            template: {
                name: "new_manager_notification", // Template name registered in Meta Business Manager
                language: {
                    code: "ru" // Specifies message language (Russian)
                },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: phoneNumber }, // Inserts client phone from session
                            { type: 'text', text: question }, // Inserts client question text
                        ]
                    }
                ]
            }
        };

        // Sends the message to Facebook Graph API using axios
        axios.post(apiUrl, messageData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`, // Includes OAuth token for authentication
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            console.log('Message successfully sent:', response.data); // Logs successful message response
        })
        .catch(error => {
            console.error('Error sending message:', error); // Logs any error from the API
        });

        // Returns success response message to client (e.g., Dialogflow)
        res.json({ fulfillmentText: "Your request has been successfully created, please wait, we will contact you shortly." });
    } catch(error) {
        // Handles unexpected runtime or network errors
        res.json({ fulfillmentText: "Failed to create the request, please contact support." });
    }
});


// Defines path to local session JSON file
const sessionsFilePath = path.join(process.cwd(), 'sessions.json');


// Reads sessions JSON data (after syncing from Cloud Storage)
async function readSessions() {
  try {
    await downloadFile(); // Downloads the latest sessions.json before reading
    const data = fs.readFileSync(sessionsFilePath, 'utf8'); // Reads JSON file from local system
    return JSON.parse(data); // Parses and returns as JS object
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Returns an empty object if file does not exist
      return {};
    } else {
      console.error('Error reading sessions:', err); // Logs unexpected error while reading
      throw err; // Re-throws the error
    }
  }
}


// Google Cloud Storage configuration and constants
const storage = new Storage();
const bucketName = 'BUCKET_NAME'; // Cloud Storage bucket name (secret — use env variable in production)
const fileName = 'sessions.json'; // File in the bucket to download
const downloadFilePath = path.join(process.cwd(), 'sessions.json'); // Local destination path


// Creates a backup copy of the local sessions.json before downloading
function backupExistingFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupFilePath = `${filePath}.${Date.now()}.bak`; // Adds timestamp to prevent overwrite
    fs.renameSync(filePath, backupFilePath); // Renames existing file as backup copy
    console.log(`Existing file backed up as ${backupFilePath}`);
  }
}


// Downloads sessions.json file from Cloud Storage bucket to local directory
async function downloadFile() {
  try {
    backupExistingFile(downloadFilePath); // Ensures old data is preserved before overwrite

    const options = {
      destination: downloadFilePath, // Destination where GCS will save the file
    };

    // Initiates download via GCS SDK
    await storage.bucket(bucketName).file(fileName).download(options);
    console.log(`${fileName} downloaded to ${downloadFilePath}`); // Logs after successful download
  } catch (err) {
    console.error('Error downloading file:', err); // Logs any issues with GCS access or permissions
    throw err; // Throws error for upper-level handling
  }
}
