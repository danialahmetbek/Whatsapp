import * as dialogflow from '@google-cloud/dialogflow-cx'; // Import Dialogflow CX SDK
import { GoogleAuth } from 'google-auth-library'; // Used for authenticating service accounts and tokens
import { fileURLToPath } from 'url'; // Converts import.meta.url to local file path
import { dirname, join } from 'path'; // Directory and path manipulation utilities
import dotenv from 'dotenv'; // Loads environment variables from .env file
import fs from 'fs'; // Node.js file system module
import { Storage } from '@google-cloud/storage'; // Google Cloud Storage SDK


dotenv.config(); // Load environment variables from .env file into process.env


// Retrieve execution context file and directory name from ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// Load environment variables for Dialogflow CX setup
const PROJECT_ID = process.env.PROJECT_ID; // GCP project where the CX agent is deployed
const LOCATION = process.env.LOCATION; // Dialogflow CX region
const AGENT_ID = process.env.AGENT_ID; // Dialogflow CX agent ID


// Path to JSON key file for service account authentication
const keyFile = join(__dirname, process.env.AGENT_PATH); // Service account key file path


/**
 * Creates an authenticated Dialogflow CX session client.
 * @returns {dialogflow.v3.SessionsClient} Authenticated Dialogflow CX session client.
 */
async function createDialogflowClient() {
  try {
    const keyFileContent = fs.readFileSync(keyFile, 'utf8'); // Reads service account key file
    const keyFileJson = JSON.parse(keyFileContent); // Parses JSON credentials

    const auth = new GoogleAuth({
      credentials: keyFileJson,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'], // Ensures full Dialogflow access
    });

    const authClient = await auth.getClient(); // Authenticates using provided JSON credentials
    console.log('Authenticated successfully');

    const clientOptions = {
      apiEndpoint: `${LOCATION}-dialogflow.googleapis.com`, // Region-specific Dialogflow endpoint
      credentials: keyFileJson, // Uses key JSON for authentication
    };

    const sessionClient = new dialogflow.v3.SessionsClient(clientOptions);
    return sessionClient; // Returns authenticated client instance
  } catch (error) {
    console.error('Failed to authenticate:', error);
    throw error;
  }
}


/**
 * Sends a user text query to Dialogflow CX and retrieves response.
 * @param {dialogflow.v3.SessionsClient} sessionClient - Dialogflow CX client.
 * @param {string} text - User input string.
 * @param {string} sessionId - Unique Dialogflow CX session ID.
 * @param {string} phoneNumber - (Optional) Associated phone number for language context.
 * @returns {string} The detected intent's text reply.
 */
async function detectIntent(sessionClient, text, sessionId, phoneNumber) {
  const sessionPath = sessionClient.projectLocationAgentSessionPath(
    PROJECT_ID,
    LOCATION,
    AGENT_ID,
    sessionId
  );

  // Defines the Dialogflow CX detectIntent request payload
  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: text,
      },
      languageCode: "en", // Default query language
    },
  };

  try {
    const [response] = await sessionClient.detectIntent(request); // Sends intent detection request

    if (response.queryResult) {
      // Extracts all response message texts returned by Dialogflow CX
      const textResponse = response.queryResult.responseMessages
        .map((message) => (message.text ? message.text.text : ''))
        .join('\n');
        
      // Translation and language logic (commented out)
      // const lang = await checkLanguage(phoneNumber, text);
      // const resultResponse = await translateLanguage(textResponse, lang);

      return textResponse;
    } else {
      throw new Error('Response is undefined or invalid');
    }
  } catch (error) {
    console.error('Error detecting intent:', error);
    throw error;
  }
}


/**
 * Main callable function to handle Dialogflow CX text requests.
 * @param {string} text - Input text from user.
 * @param {string} sessionId - Session ID for the conversation.
 * @param {string} phoneNumber - Associated user phone number.
 * @returns {string} Detected intent text response.
 */
export default async function main(text, sessionId, phoneNumber) {
  try {
    const sessionClient = await createDialogflowClient(); // Creates authenticated Dialogflow client
    const textResponse = await detectIntent(sessionClient, text, sessionId, phoneNumber); // Gets response from CX
    return textResponse;
  } catch (error) {
    console.error('Error in main function:', error);
    throw error;
  }
}


// Detects language of user input text using Google Cloud Translate
async function detectLanguage(text) {
  const { Translate } = await import('@google-cloud/translate').then(module => module.v2);
  const translate = new Translate({
    projectId: PROJECT_ID,
    keyFilename: process.env.AGENT_PATH, // Uses same service account for Translate API
  });

  try {
    const [detection] = await translate.detect(text);
    //console.log(`Detected language: ${detection.language}`);

    // Checks whether detected language belongs to Turkic / Kazakh-related family
    const kazakhRelated = ["ky", "ug", "uz", "tk", "tt", "ba", "cv", "sah", "kaa", "crh", "mn"];
    if (kazakhRelated.includes(detection.language)) {
        return "kk";
    } else {
        return "ru";
    }
  } catch (error) {
    console.error('ERROR:', error);
  }
}


// Translates output text into specified language
async function translateLanguage(res, lang) {
  const { Translate } = await import('@google-cloud/translate').then(module => module.v2);
  const translate = new Translate({
    projectId: PROJECT_ID,
    keyFilename: process.env.AGENT_PATH,
  });
  try {
    const [translation] = await translate.translate(res, lang);
    //console.log(`Translated text: ${translation}`);
    return translation;
  } catch(error) {
    console.error("ERROR:", error);
  }
}


// Initializes Google Cloud Storage for persistent data handling
const storage = new Storage();
const bucketName = 'BUCKET_NAME'; // Name of the Cloud Storage bucket
const fileName = 'language.json'; // File name for storing user language map
const downloadFilePath = join(process.cwd(), 'language.json'); // Local file path


// Uploads updated language.json file to Cloud Storage
async function uploadFile() {
  try {
    await storage.bucket(bucketName).upload(downloadFilePath, {
      destination: fileName,
    });
    console.log(`${fileName} uploaded to ${bucketName}`);
  } catch (err) {
    console.error('Error uploading file:', err);
  }
}


// Creates a backup of an existing file to preserve previous data
function backupExistingFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupFilePath = `${filePath}.${Date.now()}.bak`; // Timestamp to ensure unique backup
    fs.renameSync(filePath, backupFilePath);
    console.log(`Existing file backed up as ${backupFilePath}`);
  }
}


// Downloads language.json from Cloud Storage to local system
async function downloadFile() {
  try {
    backupExistingFile(downloadFilePath); // Backup before download

    const options = {
      destination: downloadFilePath,
    };

    await storage.bucket(bucketName).file(fileName).download(options); // Executes the download
    console.log(`${fileName} downloaded to ${downloadFilePath}`);
  } catch (err) {
    console.error('Error downloading file:', err);
    throw err; // Re-throws to propagate failure upward
  }
}


// Checks user-specific language preference from Cloud Storage JSON or detects new one
// Not in use
async function checkLanguage(phoneNumber, text) {
  await downloadFile(); // Ensures latest data is retrieved from bucket
  let lang = "";
  let data = JSON.parse(fs.readFileSync(downloadFilePath, 'utf8')); // Reads and parses local language.json

  if (data[phoneNumber]) {
    // Returns existing stored language
    lang = data[phoneNumber];
  } else if (text.length > 25) {
    // If text is long enough, perform detection and store the result
    lang = await detectLanguage(text);
    data[phoneNumber] = lang;
    await writeSessions(data); // Writes updated mapping
  } else {
    // For short messages, just perform detection without storing result
    lang = await detectLanguage(text);
  }

  return lang;
}


// Writes updated user language data to local JSON and uploads to Cloud Storage
async function writeSessions(sessions) {
  try {
    fs.writeFileSync(downloadFilePath, JSON.stringify(sessions, null, 2)); // Writes formatted JSON locally
    console.log("Wrote sessions:", JSON.stringify(sessions, null, 2));
    await uploadFile(); // Synchronizes updated file to Cloud Storage
  } catch (err) {
    console.error('Error writing sessions:', err);
  }
}
