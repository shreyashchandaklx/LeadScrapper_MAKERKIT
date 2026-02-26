export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'Missing email or otp' });
    }

    // Your MailerSend API Key
    const MAILERSEND_API_KEY = "mlsn.b8b334975ded87ed9eed0e705880fa81706c697af15c046295663bad0f6784fc";
    
    // IMPORTANT: You MUST change this to the verified domain from your MailerSend dashboard! 
    // Usually it looks like MS_xxxxx@trial-xxxxx.mlsender.net if you are on a free trial domain.
    const FROM_EMAIL = "hello@trial-YOUR-MAILERSEND-DOMAIN.mlsender.net"; 

    try {
        const response = await fetch('https://api.mailersend.com/v1/email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Authorization': `Bearer ${MAILERSEND_API_KEY}`
            },
            body: JSON.stringify({
                from: {
                    email: FROM_EMAIL,
                    name: "Lead Scraper Login"
                },
                to: [
                    {
                        email: email
                    }
                ],
                subject: "Your Lead Scraper OTP",
                text: `Your secure one-time password is: ${otp}`,
                html: `<div>
                         <h2>Login Verification</h2>
                         <p>Your secure one-time password is: <strong style="font-size: 24px;">${otp}</strong></p>
                         <p>Please enter this code to login.</p>
                       </div>`
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error("MailerSend API Error:", errorData);
            return res.status(response.status).json({ error: 'Error sending email', details: errorData });
        }

        return res.status(200).json({ message: 'Email sent successfully' });
    } catch (error) {
        console.error("Function Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
