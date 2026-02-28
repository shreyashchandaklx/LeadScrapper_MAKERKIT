export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const RESEND_API_KEY = 're_CJdJkCQu_FNFo6S3P9meonG3niaedpo3g'; // Ideally stored in env variables, but placed here for now per user request.

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Acme <onboarding@resend.dev>', // REPLACE THIS WITH YOUR PREFERRED FROM EMAIL
        to: [email],
        subject: 'Your Login OTP',
        html: `<p>Your One-Time Password (OTP) for login is: <strong>${otp}</strong></p>`
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Resend error:', errorData);
      return res.status(response.status).json({ error: 'Failed to send email' });
    }

    const data = await response.json();
    return res.status(200).json({ success: true, data });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
