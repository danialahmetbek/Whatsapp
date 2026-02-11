import functions from '@google-cloud/functions-framework'; // Imports the Google Cloud Functions framework
import axios from 'axios'; // Used for making HTTP requests (to Facebook Graph API)
import { Storage } from '@google-cloud/storage'; // Google Cloud Storage client
import fs from 'fs'; // Node.js file system module
import path from 'path'; // Path manipulation module


// Facebook Graph API endpoint and credentials (should come from environment variables)
const apiUrl = `https://graph.facebook.com/v22.0/${process.env.PHONE_ID}/messages`; // WhatsApp messaging endpoint
const accessToken = process.env.GRAPH_API_TOKEN; // Facebook Graph API token (keep secret)
const phone_number = process.env.PHONE_NUMBER; // The main WhatsApp phone number used for sending messages


// Defines an HTTP Cloud Function named 'newAccident'
functions.http('newAccident', async (req, res) => {
    try {
        const sessionId = req.query['X-SESSION']; // Retrieves session ID from query parameters
        const obj = await readSessions(); // Reads user's session from Cloud Storage
        const phoneNumber = Object.keys(obj).find(key => obj[key] === sessionId); // Finds the phone number matching the given session
        const {name, organization, problem} = req.body; // Extracts user input fields from the request body

        // Message data to send via WhatsApp template
        const messageData = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone_number,
            type: "template",
            template: {
                name: "new_accident_notification", // WhatsApp message template name configured in Meta Business
                language: {
                    code: "ru" // Template language code
                },
                components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: name }, // Inserts user's name into template
                        { type: 'text', text: organization }, // Inserts organization name
                        { type: 'text', text: problem }, // Inserts issue description
                        { type: 'text', text: phoneNumber }, // Inserts linked user phone number for contact
                    ]
                }
                ]
            }
        };

        // Sends the WhatsApp message via Graph API
        axios.post(apiUrl, messageData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`, // Uses API token for authentication
                'Content-Type': 'application/json'
            }
            })
            .then(response => {
            console.log('Message sent successfully:', response.data); // Logs success response
            })
            .catch(error => {
            console.error('Message sending error:', error); // Logs any sending error
        });
        res.json({ fulfillmentText: "Your request has been successfully created, please wait, we will contact you shortly." });
    } catch(error) {
        // Catches unexpected errors and sends failure message
        res.json({ fulfillmentText: "Failed to create request, please contact support." });
    }
});


// Local JSON file path to temporarily store session data
const sessionsFilePath = path.join(process.cwd(), 'sessions.json');


// Reads session mapping from local JSON file after downloading from Cloud Storage
async function readSessions() {
  try {
    await downloadFile(); // Ensures latest sessions file is downloaded first
    const data = fs.readFileSync(sessionsFilePath, 'utf8'); // Reads file content as text

    return JSON.parse(data); // Parses and returns JSON object
  } catch (err) {
    if (err.code === 'ENOENT') {
      // If file not found, return an empty mapping
      return {};
    } else {
      console.error('Error reading sessions:', err); // Logs other file I/O errors
      throw err; // Re-throws for upper-level handling
    }
  }
}


// Initializes Google Cloud Storage client and related constants
const storage = new Storage();
const bucketName = 'BUCKET_NAME'; // Cloud Storage bucket name (secret — use env variable in production)
const fileName = 'sessions.json'; // File name in the bucket
const downloadFilePath = path.join(process.cwd(), 'sessions.json'); // Local destination for downloaded file


// Creates a backup copy of the existing sessions.json before overwriting
function backupExistingFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupFilePath = `${filePath}.${Date.now()}.bak`; // Adds timestamp for backup naming
    fs.renameSync(filePath, backupFilePath); // Renames to preserve previous version
    console.log(`Existing file backed up as ${backupFilePath}`);
  }
}


// Downloads sessions.json from Cloud Storage to the local filesystem
async function downloadFile() {
  try {
    backupExistingFile(downloadFilePath); // Makes sure old data isn't lost

    const options = {
      destination: downloadFilePath, // Local destination path
    };

    // Performs file download from Google Cloud Storage
    await storage.bucket(bucketName).file(fileName).download(options);
    console.log(`${fileName} downloaded to ${downloadFilePath}`);
  } catch (err) {
    console.error('Error downloading file:', err); // Logs Cloud Storage transfer issues
    throw err; // Re-throws for error propagation
  }
}
