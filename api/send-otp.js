export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'Missing email or otp' });
    }

    // New Resend API Key
    const RESEND_API_KEY = "re_g6K8WK68_B9TZTc43HY2AqfGkcugSwjz3";
    
    // Resend free tier without a custom verified domain requires sending from 'onboarding@resend.dev'
    const FROM_EMAIL = "onboarding@resend.dev"; 

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_API_KEY}`
            },
            body: JSON.stringify({
                from: `Lead Scraper Login <${FROM_EMAIL}>`,
                to: [email],
                subject: "Your Lead Scraper OTP",
                html: `<div>
                         <h2>Login Verification</h2>
                         <p>Your secure one-time password is: <strong style="font-size: 24px;">${otp}</strong></p>
                         <p>Please enter this code to login.</p>
                       </div>`
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error("Resend API Error:", errorData);
            return res.status(response.status).json({ error: 'Error sending email via Resend', details: errorData });
        }

        const responseData = await response.json();
        return res.status(200).json({ message: 'Email sent successfully via Resend', id: responseData.id });
    } catch (error) {
        console.error("Function Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
