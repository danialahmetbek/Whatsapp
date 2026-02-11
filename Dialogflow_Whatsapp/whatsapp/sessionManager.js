import fs from 'fs'; // Node.js file system module for reading/writing JSON
import path from 'path'; // Path utilities for cross-platform file handling
import CryptoJS from 'crypto-js'; // Crypto library for secure session ID generation
import { Storage } from '@google-cloud/storage'; // Google Cloud Storage SDK for persistent storage


// Defines path to local sessions.json file (phone → session ID mapping)
const sessionsFilePath = path.join(process.cwd(), 'sessions.json');


// Reads session mapping from local JSON file (after downloading from Cloud Storage)
async function readSessions() {
  try {
    await downloadFile(); // Ensures latest data from Cloud Storage
    const data = fs.readFileSync(sessionsFilePath, 'utf8'); // Reads file content
    return JSON.parse(data); // Returns parsed object { phone: sessionId }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Returns empty object if no sessions file exists yet
      return {};
    } else {
      throw err; // Re-throws other errors
    }
  }
}


// Writes updated session mapping to local JSON and syncs to Cloud Storage
async function writeSessions(sessions) {
  try {
    fs.writeFileSync(sessionsFilePath, JSON.stringify(sessions, null, 2)); // Writes pretty-printed JSON
    await uploadFile(); // Syncs to Cloud Storage for persistence
  } catch (err) {
    console.error('Error writing sessions:', err);
  }
}


// Main exported function: gets or creates session ID for a specific user
async function getSessionId(userId) {
  const sessions = await readSessions(); // Loads current session mapping
  if (!sessions[userId]) {
    // Creates new session if user doesn't have one
    const sessionId = generateSessionId(userId);
    sessions[userId] = sessionId;
    writeSessions(sessions); // Persists new mapping
  }
  return sessions[userId]; // Returns existing or newly created session ID
}


// Generates cryptographically secure, unique session ID for new users
function generateSessionId(userId) {
  const randomString = Math.random().toString(36).substring(2, 15); // 13-char random string
  const timestamp = Date.now().toString(36); // Current timestamp in base36
  const hash = CryptoJS.SHA256(userId + randomString + timestamp).toString(CryptoJS.enc.Hex); // SHA256 hash of combined data
  return `${randomString}-${timestamp}-${hash}-whatsapp`; // Composite format: random-timestamp-hash-platform
}


export { getSessionId, generateSessionId }; // Exports main functions for use in other modules


// Google Cloud Storage configuration for session persistence
const storage = new Storage();
const bucketName = 'BUCKET_NAME'; // Cloud Storage bucket name (secret — use env variable in production)
const fileName = 'sessions.json'; // Remote filename in bucket
const downloadFilePath = sessionsFilePath; // Local path (same as sessionsFilePath)


async function uploadFile() {
  try {
    // Uploads local sessions.json to Cloud Storage bucket
    await storage.bucket(bucketName).upload(sessionsFilePath, {
      destination: fileName,
    });
    console.log(`${fileName} uploaded to ${bucketName}`);
  } catch (err) {
    console.error('Error uploading file:', err);
  }
}


// Creates timestamped backup before overwriting existing file
function backupExistingFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupFilePath = `${filePath}.${Date.now()}.bak`; // Unique backup filename
    fs.renameSync(filePath, backupFilePath); // Renames to preserve previous data
    console.log(`Existing file backed up as ${backupFilePath}`);
  }
}


// Downloads latest sessions.json from Cloud Storage before reading
async function downloadFile() {
  try {
    backupExistingFile(downloadFilePath); // Preserves local copy first

    const options = {
      destination: downloadFilePath, // Local destination path
    };

    // Performs Cloud Storage download operation
    await storage.bucket(bucketName).file(fileName).download(options);
    console.log(`${fileName} downloaded to ${downloadFilePath}`);
  } catch (err) {
    console.error('Error downloading file:', err);
    throw err; // Re-throws for upstream error handling
  }
}
