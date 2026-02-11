import functions from '@google-cloud/functions-framework'; // Imports Google Cloud Functions HTTP framework
import axios from 'axios'; // Used for making HTTP requests (Facebook Graph API)
import { Storage } from '@google-cloud/storage'; // Google Cloud Storage SDK
import fs from 'fs'; // Node.js file system module
import path from 'path'; // Built-in module for handling file paths


// Facebook Graph API endpoint and credentials (stored in environment variables)
const apiUrl = `https://graph.facebook.com/v22.0/${process.env.PHONE_ID}/messages`; // WhatsApp API message endpoint
const accessToken = process.env.GRAPH_API_TOKEN; // Facebook Graph API token (keep secret)
const phone_number = process.env.PHONE_NUMBER; // Registered WhatsApp sender phone number


// Defines an HTTP Cloud Function "newLead"
functions.http('newLead', async (req, res) => {
    try {
        const sessionId = req.query['X-SESSION']; // Retrieves unique session ID from query parameter
        const obj = await readSessions(); // Reads the sessions object from downloaded file
        const phoneNumber = Object.keys(obj).find(key => obj[key] === sessionId); // Matches phone number to the session ID

        // Extract relevant user data from request body
        const {name, company, surface, period, location} = req.body;

        // Constructs the message payload for WhatsApp template message
        const messageData = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone_number,
            type: "template",
            template: {
                name: "new_lead_notification", // Predefined message template name in Meta Business Manager
                language: {
                    code: "ru" // Specifies language code (Russian)
                },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: name }, // Inserts user's name
                            { type: 'text', text: company }, // Inserts user's company name
                            { type: 'text', text: phoneNumber }, // Inserts user phone number from the session map
                            { type: 'text', text: surface }, // Inserts surface
                            { type: 'text', text: period }, // Inserts period or duration
                            { type: 'text', text: location } // Inserts location field
                        ]
                    }
                ]
            }
        };

        // Sends the message through the WhatsApp Graph API
        axios.post(apiUrl, messageData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`, // Authorization header with token
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            console.log('Message sent successfully:', response.data); // Logs successful API response
        })
        .catch(error => {
            console.error('Error sending message:', error); // Logs API request failure details
        });

        // Responds to the client (e.g., Dialogflow or API gateway)
        res.json({ fulfillmentText: "Your request has been successfully created, please wait, we will contact you soon." });
    } catch(error) {
        // Handles unpredicted runtime or network errors
        res.json({ fulfillmentText: "Failed to create the request, please contact support." });
    }
});


// Determines path to the local sessions file
const sessionsFilePath = path.join(process.cwd(), 'sessions.json');


// Reads session data from the file (downloaded earlier from Cloud Storage)
async function readSessions() {
  try {
    await downloadFile(); // Ensures the latest version of sessions.json is available locally
    const data = fs.readFileSync(sessionsFilePath, 'utf8'); // Reads the local file synchronously
    return JSON.parse(data); // Parses and returns the content as JSON object
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Returns empty object if file doesn’t exist (no stored sessions yet)
      return {};
    } else {
      console.error('Error reading sessions:', err); // Logs unexpected error
      throw err; // Re-throws for main error handler
    }
  }
}


// Initializes Google Cloud Storage and related parameters
const storage = new Storage();
const bucketName = 'BUCKET_NAME'; // Placeholder for bucket name (secret — use env variable in production)
const fileName = 'sessions.json'; // Name of the file stored in the bucket
const downloadFilePath = path.join(process.cwd(), 'sessions.json'); // Local download destination path


// Creates a backup copy of the current sessions file before overwriting
function backupExistingFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupFilePath = `${filePath}.${Date.now()}.bak`; // Appends timestamp for uniqueness
    fs.renameSync(filePath, backupFilePath); // Renames to backup with .bak extension
    console.log(`Existing file backed up as ${backupFilePath}`);
  }
}


// Downloads the sessions.json file from Cloud Storage
async function downloadFile() {
  try {
    backupExistingFile(downloadFilePath); // Back up old file first

    const options = {
      destination: downloadFilePath, // Local save path for downloaded file
    };

    // Performs file download via Cloud Storage SDK
    await storage.bucket(bucketName).file(fileName).download(options);
    console.log(`${fileName} downloaded to ${downloadFilePath}`); // Log confirmation after successful download
  } catch (err) {
    console.error('Error downloading file:', err); // Logs file download errors (e.g., permission/network)
    throw err; // Re-throws the error upstream for higher-level handling
  }
}
