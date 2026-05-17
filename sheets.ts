import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

let auth: any;
let sheets: any;

try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: SCOPES,
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('Google Sheets service initialized.');
  } else {
    console.warn('Google Credentials not found. Sheet update will be simulated.');
  }
} catch (error) {
  console.error('Error initializing Google Sheets:', error);
}

/**
 * Appends a new appointment row to the Google Sheet.
 * Assumes the sheet has columns: Date, Time, Patient Name, Phone, Reason, Status
 */
export async function appendToSheet(
  patientName: string,
  phoneNumber: string,
  date: string,
  time: string,
  reason: string
): Promise<void> {
  if (!sheets || !SHEET_ID) {
    console.log(`[Simulated] Added to Sheet: ${date} | ${time} | ${patientName} | ${phoneNumber} | ${reason}`);
    return;
  }

  try {
    const timestamp = new Date().toISOString();

    // We assume the first sheet (Sheet1) and appending to columns A through F
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:F', // Change 'Sheet1' if your tab is named differently
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [date, time, patientName, phoneNumber, reason, 'Scheduled']
        ],
      },
    });
    console.log('Successfully appended row to Google Sheet.');
  } catch (error) {
    console.error('Error appending to Google Sheet:', error);
  }
}
