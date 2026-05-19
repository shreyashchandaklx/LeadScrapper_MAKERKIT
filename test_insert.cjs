const fs = require('fs');
const envStr = fs.readFileSync('.env', 'utf8');
const env = {};
envStr.split('\n').forEach(line => {
    const [k, v] = line.split('=');
    if(k && v) env[k.trim()] = v.trim().replace(/^[\"']|[\"']$/g, '');
});

// Test simple insert to user_leadscrapper_leads
fetch(env.SUPABASE_URL + '/rest/v1/user_leadscrapper_leads', {
    method: 'POST',
    headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    },
    body: JSON.stringify([{
        CustomerID: 1,
        UserEmail: 'test@test.com',
        PlaceId: 'test_place_id_123',
        SearchString: 'test_search',
        Status: 'delivered',
        CreatedAt: new Date().toISOString()
    }])
})
.then(r => r.text())
.then(data => console.log('RESPONSE:', data))
.catch(console.error);
