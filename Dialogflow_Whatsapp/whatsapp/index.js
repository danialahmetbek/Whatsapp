import axios from 'axios'; // HTTP client for WhatsApp Graph API and Telegram API calls
import functions from '@google-cloud/functions-framework'; // Google Cloud Functions HTTP framework
import { getSessionId } from "./sessionManager.js"; // Custom session management utility
import crypto from 'crypto'; // Node.js crypto module for HMAC signature verification
import main from "./agentCon.js"; // Dialogflow CX integration module


// Verifies WhatsApp webhook signature using HMAC-SHA256 (security check against tampering)
function verifySignature(payload, signature, secret) {
  const hmacReceived = signature.replace('sha256=', ''); // Extracts hash from "sha256=xxx" header format
  const digest = crypto
    .createHmac('sha256', secret) // Creates HMAC using app secret and SHA256
    .update(payload, 'utf8') // Hashes the raw request body
    .digest('hex'); // Converts to hex string
  return crypto.timingSafeEqual(Buffer.from(hmacReceived, 'utf8'), Buffer.from(digest, 'utf8')); // Constant-time comparison (timing attack resistant)
}


// Environment variables for authentication and notifications
const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN } = process.env; // WhatsApp webhook verification and Graph API token
const {BOT_TOKEN, CHAT_ID, TEST_ID} = process.env // Telegram bot tokens and chat IDs for notifications

// Main WhatsApp webhook Cloud Function endpoint
functions.http('WAwebhook', async (req, res) => {
  if(req.method === "POST"){
    // Extracts the actual message from WhatsApp webhook structure
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // console.log("TYPE:", message?.type);
    
    if(message === undefined) {
        res.sendStatus(200); // Acknowledges webhook even if no message found
        return;
    }
    
    const userId = message.from; // WhatsApp user phone number (sender)
    const businessPhoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id; // Business account phone ID
    
    if (message?.type === "text") {
      try {
        const appSecret = process.env.APP_SECRET; // App secret for webhook signature verification
        const signature = req.headers['x-hub-signature-256']; // WhatsApp signature header
        const requestBody = req.rawBody; // Raw unparsed body required for signature verification

        // Verifies webhook authenticity (critical security check)
        if (!verifySignature(requestBody, signature, appSecret)) {
          console.log('Signature verification failed');
          res.status(403).send('Unexpected request'); // Rejects tampered/invalid requests
          return;
        }

        // Retrieves or creates session ID for this user
        const sessionId = await getSessionId(userId);
        
        // Sends user message to Dialogflow CX and gets AI response
        let text = await main(message.text.body, sessionId, userId);
        // console.log("ANSWER:", text);
        
        // Cleans up Dialogflow response (removes escape characters and quotes)
        text = text.replace(/\\/g, ''); // Removes all backslashes
        text = text.trim().replace(/^["']|["']$/g, ''); // Trims and removes surrounding quotes

        // Sends AI response back to user via WhatsApp Graph API
        await axios.post(
          `https://graph.facebook.com/v22.0/${businessPhoneNumberId}/messages`,
          {
            messaging_product: "whatsapp",
            to: message.from,
            text: { body: text },
          },
          {
            headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` }, // Authenticates with Graph API token
          }
        );

        // Marks the original user message as "read" in WhatsApp
        await axios.post(
          `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          {
            messaging_product: "whatsapp",
            status: "read",
            message_id: message.id,
          },
          {
            headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` },
          }
        );

        // Nested function to send notifications to Telegram (forwarded inside try block)
        async function sendMessage(text, CHAT_ID) {
            try {
                const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; // Telegram Bot API endpoint
                const response = await axios.post(url, { chat_id: CHAT_ID, text });
                // console.log('Telegram message sent:', response.data);
            } catch (error) {
                console.error('Telegram error:', error.response?.data);
            }
        }
        
        // Sends conversation notifications to telegram: main chat and test chat
        await sendMessage(`${message.from} \n Пользователь: ${message.text.body} \n\n Ответ: ${text}`, CHAT_ID);
        await sendMessage(`${message.from} \n Пользователь: ${message.text.body} \n\n Ответ: ${text}`, TEST_ID);
        
        res.sendStatus(200); // Success acknowledgment to WhatsApp
      } catch (err) {
        console.error("Error processing WhatsApp message:", err);
        res.sendStatus(500); // Internal server error
      }
    } else {
      // Non-text messages (images, documents, etc.) - just acknowledge
      res.sendStatus(200);
    }
  } else if(req.method === "GET") {
    // WhatsApp webhook verification challenge (GET request during setup)
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge); // Echoes challenge code back to WhatsApp
      console.log("Webhook verified successfully!");
    } else {
      res.sendStatus(403); // Invalid verification attempt
    }
  }
});
