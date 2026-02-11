import functions from '@google-cloud/functions-framework'; // Imports GCP Functions Framework for HTTP endpoints
import axios from 'axios'; // Library for making HTTP requests (used for Facebook Graph API calls)
import { Storage } from '@google-cloud/storage'; // Google Cloud Storage SDK
import fs from 'fs'; // Node.js File System module
import path from 'path'; // Provides utilities for file and directory paths


// Facebook Graph API endpoint and environment-based credentials
const apiUrl = `https://graph.facebook.com/v22.0/${process.env.PHONE_ID}/messages`; // WhatsApp Business API message endpoint
const accessToken = process.env.GRAPH_API_TOKEN; // Access token for Facebook Graph API (keep secret)
const phone_number = process.env.PHONE_NUMBER; // Sender’s registered WhatsApp number

// Defines a new function endpoint “newCom” deployed to Google Cloud Functions
functions.http('newCom', async (req, res) => {
    try {
        // Retrieves unique session identifier from query parameter
        const sessionId = req.query['X-SESSION'];

        // Reads session data from Cloud Storage (download + local parse)
        const obj = await readSessions(); 
        const phoneNumber = Object.keys(obj).find(key => obj[key] === sessionId); // Finds user phone number associated with this session

        // Extracts “question” field from the request body
        const {question} = req.body;

        // Constructs WhatsApp message based on a pre-approved template
        const messageData = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone_number,
            type: "template",
            template: {
                name: "new_manager_notification", // Template name defined in Meta Business Manager
                language: {
                    code: "ru" // Message language locale
                },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: phoneNumber }, // Inserts the client’s phone number
                            { type: 'text', text: question }, // Inserts the question content
                        ]
                    }
                ]
            }
        };

        // Sends an HTTP POST to Facebook Graph API
        axios.post(apiUrl, messageData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`, // Auth header using your access token
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            console.log('Message sent successfully:', response.data); // Log success response
        })
        .catch(error => {
            console.error('Message sending error:', error); // Log failure for debugging
        });

        // Sends success response back (e.g. to Dialogflow webhook)
        res.json({ fulfillmentText: "Your request has been successfully created, please wait, we will contact you shortly." });
    } catch(error) {
        // Handles and logs unexpected errors
        res.json({ fulfillmentText: "Failed to create request, please contact support." });
    }
});


// Defines local path for session storage file
const sessionsFilePath = path.join(process.cwd(), 'sessions.json');


// Reads sessions.json file after downloading from Cloud Storage
async function readSessions() {
  try {
    await downloadFile(); // Ensures the latest file is downloaded before reading
    const data = fs.readFileSync( sessionsFilePath, 'utf8' ); // Reads content as string
    
    return JSON.parse(data); // Parses and returns session data as object
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Returns empty mapping if file is missing
      return {};
    } else {
      console.error('Error reading sessions:', err); // Logs unexpected read errors
      throw err; // Rethrows error to caller
    }
  }
}


// Cloud Storage client configuration
const storage = new Storage(); 
const bucketName = 'BUCKET_NAME'; // Bucket name placeholder (secret — use env variable in production)
const fileName = 'sessions.json'; // File to be downloaded from the bucket
const downloadFilePath = path.join(process.cwd(), 'sessions.json'); // Local temporary storage path


// Backs up existing local sessions.json before overwriting
function backupExistingFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupFilePath = `${filePath}.${Date.now()}.bak`; // Adds a timestamp to avoid overwriting previous backup
    fs.renameSync(filePath, backupFilePath); // Renames to backup file
    console.log(`Existing file backed up as ${backupFilePath}`);
  }
}


// Downloads sessions.json from Cloud Storage into the local directory
async function downloadFile() {
  try {
    backupExistingFile(downloadFilePath); // Protects existing file before new download

    const options = {
      destination: downloadFilePath, // Target file path where GCS will save the file
    };

    // Executes download using GCS SDK
    await storage.bucket(bucketName).file(fileName).download(options);
    console.log(`${fileName} downloaded to ${downloadFilePath}`); // Confirms download success in logs
  } catch (err) {
    console.error('Error downloading file:', err); // Logs download or permission issues
    throw err; // Rethrows for handling upstream
  }
}
