/**
 * India — States, Union Territories & Cities
 * Comprehensive dataset for cascading location dropdowns.
 */

const INDIA_STATES_CITIES = {
  "Andhra Pradesh": [
    "Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Rajahmundry",
    "Tirupati", "Kadapa", "Kakinada", "Anantapur", "Eluru", "Ongole", "Srikakulam",
    "Vizianagaram", "Machilipatnam", "Tenali", "Hindupur", "Proddatur", "Chittoor",
    "Adoni", "Bhimavaram", "Tadepalligudem", "Gudivada", "Narasaraopet", "Madanapalle",
    "Chilakaluripet", "Guntakal", "Dharmavaram", "Gudur", "Tadipatri", "Mangalagiri",
    "Markapur", "Chirala", "Bapatla", "Kavali", "Amalapuram", "Sattenapalle"
  ],
  "Arunachal Pradesh": [
    "Itanagar", "Naharlagun", "Pasighat", "Tawang", "Ziro", "Bomdila",
    "Along", "Tezu", "Aalo", "Daporijo", "Seppa", "Namsai", "Roing",
    "Khonsa", "Changlang", "Yingkiong", "Anini", "Koloriang", "Hawai"
  ],
  "Assam": [
    "Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia",
    "Tezpur", "Bongaigaon", "Karimganj", "North Lakhimpur", "Dhubri",
    "Goalpara", "Sivasagar", "Golaghat", "Nalbari", "Barpeta", "Mangaldoi",
    "Hojai", "Haflong", "Diphu", "Kokrajhar", "Lanka", "Lumding", "Mushalpur"
  ],
  "Bihar": [
    "Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Purnia", "Darbhanga",
    "Bihar Sharif", "Arrah", "Begusarai", "Katihar", "Munger", "Chhapra",
    "Hajipur", "Sasaram", "Dehri", "Bettiah", "Motihari", "Saharsa",
    "Siwan", "Jehanabad", "Nawada", "Lakhisarai", "Buxar", "Kishanganj",
    "Jamui", "Sitamarhi", "Madhubani", "Supaul", "Samastipur", "Aurangabad",
    "Gopalganj", "Chapra", "Nalanda", "Sheikhpura", "Khagaria"
  ],
  "Chhattisgarh": [
    "Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon",
    "Raigarh", "Jagdalpur", "Ambikapur", "Dhamtari", "Mahasamund",
    "Chirmiri", "Kawardha", "Dongargarh", "Bhatapara", "Kanker",
    "Mungeli", "Kondagaon", "Janjgir", "Balod", "Gariaband"
  ],
  "Goa": [
    "Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim",
    "Curchorem", "Sanquelim", "Cuncolim", "Sanguem", "Canacona",
    "Quepem", "Pernem", "Cortalim", "Aldona"
  ],
  "Gujarat": [
    "Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar",
    "Junagadh", "Gandhinagar", "Anand", "Nadiad", "Morbi", "Mehsana",
    "Bharuch", "Navsari", "Surendranagar", "Porbandar", "Veraval",
    "Gandhidham", "Godhra", "Patan", "Botad", "Dahod", "Palanpur",
    "Valsad", "Amreli", "Deesa", "Jetpur", "Modasa", "Kalol",
    "Gondal", "Keshod", "Dholka", "Dwarka", "Bhuj", "Halol"
  ],
  "Haryana": [
    "Faridabad", "Gurugram", "Panipat", "Ambala", "Yamunanagar", "Rohtak",
    "Hisar", "Karnal", "Sonipat", "Panchkula", "Bhiwani", "Sirsa",
    "Bahadurgarh", "Jind", "Thanesar", "Kaithal", "Rewari", "Palwal",
    "Pinjore", "Hansi", "Narnaul", "Fatehabad", "Mahendragarh",
    "Tohana", "Hodal", "Ratia", "Sohna", "Dharuhera", "Assandh"
  ],
  "Himachal Pradesh": [
    "Shimla", "Dharamshala", "Solan", "Mandi", "Palampur", "Baddi",
    "Nahan", "Paonta Sahib", "Sundarnagar", "Kullu", "Manali",
    "Chamba", "Una", "Hamirpur", "Bilaspur", "Kangra", "Dalhousie",
    "Parwanoo", "Nalagarh", "Rampur", "Keylong", "Kasauli", "Kufri"
  ],
  "Jharkhand": [
    "Ranchi", "Jamshedpur", "Dhanbad", "Bokaro Steel City", "Deoghar",
    "Hazaribagh", "Giridih", "Ramgarh", "Medininagar", "Chaibasa",
    "Phusro", "Dumka", "Chakradharpur", "Chatra", "Chirkunda",
    "Godda", "Gumla", "Lohardaga", "Mihijam", "Koderma", "Jamtara",
    "Pakur", "Sahibganj", "Latehar", "Simdega", "Saraikela"
  ],
  "Karnataka": [
    "Bangalore", "Mysore", "Hubli", "Mangalore", "Belgaum", "Gulbarga",
    "Davanagere", "Bellary", "Bijapur", "Shimoga", "Tumkur", "Raichur",
    "Bidar", "Hospet", "Hassan", "Gadag", "Udupi", "Robertson Pet",
    "Mandya", "Bhadravati", "Chitradurga", "Kolar", "Chikmagalur",
    "Gangavati", "Bagalkot", "Ranebennur", "Sagara", "Harihara",
    "Chintamani", "Madikeri", "Tirthahalli", "Yadgir", "Channapatna"
  ],
  "Kerala": [
    "Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam",
    "Kannur", "Alappuzha", "Palakkad", "Malappuram", "Kottayam",
    "Kasaragod", "Manjeri", "Thodupuzha", "Kayamkulam", "Perinthalmanna",
    "Guruvayoor", "Ponnani", "Vatakara", "Chalakudy", "Cherthala",
    "Changanassery", "Punalur", "Edappal", "Irinjalakuda", "Tirur",
    "Kothamangalam", "Adoor", "Payyannur", "Shoranur", "Taliparamba"
  ],
  "Madhya Pradesh": [
    "Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar",
    "Dewas", "Satna", "Ratlam", "Rewa", "Murwara", "Singrauli",
    "Burhanpur", "Khandwa", "Bhind", "Chhindwara", "Guna", "Shivpuri",
    "Vidisha", "Damoh", "Chhatarpur", "Mandsaur", "Khargone", "Neemuch",
    "Pithampur", "Hoshangabad", "Itarsi", "Sehore", "Betul", "Seoni",
    "Datia", "Nagda", "Morena", "Tikamgarh", "Shahdol", "Narsinghpur"
  ],
  "Maharashtra": [
    "Mumbai", "Pune", "Nagpur", "Thane", "Nashik", "Aurangabad",
    "Solapur", "Kolhapur", "Amravati", "Navi Mumbai", "Sangli",
    "Malegaon", "Jalgaon", "Akola", "Latur", "Ahmednagar", "Dhule",
    "Chandrapur", "Parbhani", "Ichalkaranji", "Jalna", "Ambarnath",
    "Bhiwandi", "Panvel", "Badlapur", "Beed", "Wardha", "Satara",
    "Osmanabad", "Gondia", "Nandurbar", "Washim", "Hingoli", "Ratnagiri",
    "Sindhudurg", "Kalyan", "Vasai-Virar", "Mira-Bhayandar", "Ulhasnagar"
  ],
  "Manipur": [
    "Imphal", "Thoubal", "Bishnupur", "Churachandpur", "Kakching",
    "Ukhrul", "Senapati", "Tamenglong", "Chandel", "Jiribam",
    "Moirang", "Moreh", "Kangpokpi", "Noney"
  ],
  "Meghalaya": [
    "Shillong", "Tura", "Jowai", "Nongstoin", "Williamnagar",
    "Baghmara", "Resubelpara", "Mairang", "Nongpoh", "Cherrapunji",
    "Mawkyrwat", "Ampati", "Dawki"
  ],
  "Mizoram": [
    "Aizawl", "Lunglei", "Champhai", "Saiha", "Kolasib", "Serchhip",
    "Lawngtlai", "Mamit", "Hnahthial", "Saitual", "Khawzawl"
  ],
  "Nagaland": [
    "Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha", "Zunheboto",
    "Mon", "Phek", "Kiphire", "Longleng", "Peren", "Chumukedima"
  ],
  "Odisha": [
    "Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur",
    "Puri", "Balasore", "Brahmapur", "Baripada", "Bhadrak", "Jharsuguda",
    "Jeypore", "Bargarh", "Dhenkanal", "Paradip", "Kendrapara",
    "Sundargarh", "Koraput", "Rayagada", "Angul", "Jagatsinghpur",
    "Jajpur", "Phulbani", "Bolangir", "Bhawanipatna", "Kendujhar"
  ],
  "Punjab": [
    "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda",
    "Mohali", "Pathankot", "Hoshiarpur", "Batala", "Moga", "Abohar",
    "Malerkotla", "Khanna", "Barnala", "Phagwara", "Muktsar",
    "Rajpura", "Firozpur", "Kapurthala", "Sangrur", "Faridkot",
    "Gurdaspur", "Nawanshahr", "Mansa", "Ropar", "Zirakpur", "Dera Bassi"
  ],
  "Rajasthan": [
    "Jaipur", "Jodhpur", "Kota", "Bikaner", "Ajmer", "Udaipur",
    "Bhilwara", "Alwar", "Bharatpur", "Sikar", "Pali", "Sri Ganganagar",
    "Tonk", "Kishangarh", "Beawar", "Hanumangarh", "Dhaulpur",
    "Gangapur City", "Sawai Madhopur", "Barmer", "Churu", "Nagaur",
    "Jhunjhunu", "Jhalawar", "Bundi", "Chittorgarh", "Dungarpur",
    "Banswara", "Rajsamand", "Pratapgarh", "Sirohi", "Jaisalmer",
    "Dausa", "Mount Abu", "Pushkar", "Nathdwara"
  ],
  "Sikkim": [
    "Gangtok", "Namchi", "Gyalshing", "Mangan", "Rangpo", "Singtam",
    "Jorethang", "Geyzing", "Ravangla", "Pelling", "Lachung"
  ],
  "Tamil Nadu": [
    "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem",
    "Tirunelveli", "Tirupur", "Ranipet", "Erode", "Vellore", "Thoothukudi",
    "Dindigul", "Thanjavur", "Nagercoil", "Kanchipuram", "Cuddalore",
    "Kumbakonam", "Karur", "Hosur", "Rajapalayam", "Sivakasi",
    "Pollachi", "Namakkal", "Villupuram", "Ambur", "Aruppukkottai",
    "Virudhunagar", "Perambalur", "Dharmapuri", "Krishnagiri",
    "Nagapattinam", "Mayiladuthurai", "Arakkonam", "Gudiyatham",
    "Udhagamandalam", "Kodaikanal", "Mamallapuram"
  ],
  "Telangana": [
    "Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam",
    "Ramagundam", "Mahbubnagar", "Nalgonda", "Adilabad", "Suryapet",
    "Miryalaguda", "Siddipet", "Mancherial", "Jagtial", "Kamareddy",
    "Nirmal", "Wanaparthy", "Medak", "Zahirabad", "Bodhan",
    "Sangareddy", "Bhongir", "Vikarabad", "Jangaon", "Narayanpet"
  ],
  "Tripura": [
    "Agartala", "Udaipur", "Dharmanagar", "Kailashahar", "Belonia",
    "Ambassa", "Kamalpur", "Khowai", "Sabroom", "Bishalgarh",
    "Sonamura", "Melaghar", "Amarpur"
  ],
  "Uttar Pradesh": [
    "Lucknow", "Kanpur", "Ghaziabad", "Agra", "Varanasi", "Meerut",
    "Prayagraj", "Bareilly", "Moradabad", "Aligarh", "Saharanpur",
    "Noida", "Gorakhpur", "Firozabad", "Jhansi", "Muzaffarnagar",
    "Mathura", "Rampur", "Shahjahanpur", "Farrukhabad", "Mau",
    "Hapur", "Etawah", "Mirzapur", "Bulandshahr", "Sambhal",
    "Amroha", "Hardoi", "Fatehpur", "Raebareli", "Orai", "Unnao",
    "Lakhimpur Kheri", "Sitapur", "Sultanpur", "Azamgarh", "Deoria",
    "Basti", "Bahraich", "Gonda", "Jaunpur", "Pratapgarh", "Banda",
    "Ayodhya", "Greater Noida", "Etah", "Mainpuri", "Hathras"
  ],
  "Uttarakhand": [
    "Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rudrapur",
    "Kashipur", "Rishikesh", "Kotdwar", "Pithoragarh", "Srinagar",
    "Almora", "Nainital", "Mussoorie", "Pauri", "Bageshwar",
    "Chamoli", "Champawat", "Uttarkashi", "Tehri", "Ramnagar",
    "Jaspur", "Manglaur", "Laksar"
  ],
  "West Bengal": [
    "Kolkata", "Howrah", "Asansol", "Siliguri", "Durgapur", "Bardhaman",
    "Malda", "Baharampur", "Habra", "Kharagpur", "Shantipur", "Dankuni",
    "Raiganj", "Haldia", "Bally", "Medinipur", "Krishnanagar", "Ranaghat",
    "Jalpaiguri", "Balurghat", "Basirhat", "Bankura", "Purulia",
    "Cooch Behar", "Darjeeling", "Alipurduar", "Contai", "Tamluk",
    "English Bazar", "Raghunathpur", "Bolpur", "Jangipur", "Katwa",
    "Nabadwip", "Diamond Harbour", "Barrackpore", "Serampore", "Kalyani"
  ],
  // Union Territories
  "Andaman and Nicobar Islands": [
    "Port Blair", "Diglipur", "Rangat", "Mayabunder", "Hut Bay",
    "Car Nicobar", "Campbell Bay"
  ],
  "Chandigarh": [
    "Chandigarh"
  ],
  "Dadra and Nagar Haveli and Daman and Diu": [
    "Silvassa", "Daman", "Diu", "Amli", "Khanvel"
  ],
  "Delhi": [
    "New Delhi", "Delhi", "Dwarka", "Rohini", "Saket", "Karol Bagh",
    "Connaught Place", "Lajpat Nagar", "Shahdara", "Pitampura",
    "Janakpuri", "Vasant Kunj", "Mayur Vihar", "Nehru Place",
    "Chandni Chowk", "Rajouri Garden", "Preet Vihar", "Uttam Nagar",
    "Patel Nagar", "Green Park", "Defence Colony", "South Extension",
    "Greater Kailash", "Hauz Khas", "Okhla", "Narela", "Najafgarh",
    "Mundka", "Burari"
  ],
  "Jammu and Kashmir": [
    "Srinagar", "Jammu", "Anantnag", "Baramulla", "Sopore", "Kathua",
    "Udhampur", "Pulwama", "Kupwara", "Rajouri", "Poonch", "Doda",
    "Kishtwar", "Leh", "Kargil", "Ganderbal", "Budgam", "Bandipora",
    "Shopian", "Kulgam", "Reasi", "Ramban", "Samba"
  ],
  "Ladakh": [
    "Leh", "Kargil", "Diskit", "Padum", "Hunder", "Nubra", "Drass"
  ],
  "Lakshadweep": [
    "Kavaratti", "Agatti", "Amini", "Andrott", "Minicoy", "Kalpeni"
  ],
  "Puducherry": [
    "Puducherry", "Karaikal", "Mahe", "Yanam", "Ozhukarai", "Villianur"
  ]
};

// Extensible countries datasets
const US_STATES_CITIES = {
  "California": ["Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento", "Fresno"],
  "Texas": ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso"],
  "Florida": ["Miami", "Orlando", "Tampa", "Jacksonville", "Tallahassee", "Fort Lauderdale"],
  "New York": ["New York City", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany"],
  "Illinois": ["Chicago", "Aurora", "Naperville", "Joliet", "Springfield", "Peoria"],
  "Pennsylvania": ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton"],
  "Ohio": ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton"],
  "Georgia": ["Atlanta", "Augusta", "Columbus", "Macon", "Savannah", "Athens"],
  "North Carolina": ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville"],
  "Michigan": ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing"]
};

const UK_STATES_CITIES = {
  "England": ["London", "Birmingham", "Manchester", "Leeds", "Liverpool", "Newcastle", "Sheffield", "Bristol", "Nottingham", "Southampton"],
  "Scotland": ["Glasgow", "Edinburgh", "Aberdeen", "Dundee", "Inverness", "Stirling", "Perth"],
  "Wales": ["Cardiff", "Swansea", "Newport", "Bangor", "St Asaph"],
  "Northern Ireland": ["Belfast", "Derry", "Lisburn", "Newry", "Armagh"]
};

const CA_STATES_CITIES = {
  "Ontario": ["Toronto", "Ottawa", "Mississauga", "Brampton", "Hamilton", "London"],
  "Quebec": ["Montreal", "Quebec City", "Laval", "Gatineau", "Longueuil", "Sherbrooke"],
  "British Columbia": ["Vancouver", "Surrey", "Burnaby", "Richmond", "Abbotsford", "Victoria"],
  "Alberta": ["Calgary", "Edmonton", "Red Deer", "Lethbridge", "St. Albert"]
};

const AU_STATES_CITIES = {
  "New South Wales": ["Sydney", "Newcastle", "Central Coast", "Wollongong", "Maitland"],
  "Victoria": ["Melbourne", "Geelong", "Ballarat", "Bendigo", "Melton"],
  "Queensland": ["Brisbane", "Gold Coast", "Sunshine Coast", "Townsville", "Cairns"],
  "Western Australia": ["Perth", "Mandurah", "Bunbury", "Busselton", "Albany"],
  "South Australia": ["Adelaide", "Mount Gambier", "Gawler", "Whyalla", "Murray Bridge"]
};

const AE_STATES_CITIES = {
  "Dubai": ["Dubai", "Jebel Ali", "Hatta"],
  "Abu Dhabi": ["Abu Dhabi", "Al Ain", "Ruwais", "Madinat Zayed"],
  "Sharjah": ["Sharjah", "Khor Fakkan", "Kalba", "Dibba Al-Hisn"],
  "Ajman": ["Ajman", "Manama", "Masfout"],
  "Ras Al Khaimah": ["Ras Al Khaimah", "Ar-Rams"],
  "Fujairah": ["Fujairah", "Dibba Al-Fujairah"],
  "Umm Al Quwain": ["Umm Al Quwain"]
};

// Map country codes to their dataset
const COUNTRY_DATASETS = {
  "IN": INDIA_STATES_CITIES,
  "US": US_STATES_CITIES,
  "GB": UK_STATES_CITIES,
  "CA": CA_STATES_CITIES,
  "AU": AU_STATES_CITIES,
  "AE": AE_STATES_CITIES
};

// Countries list
const COUNTRIES = [
  { code: "IN", name: "India" },
];

// Get all states sorted alphabetically
function getStates(countryCode) {
  const dataset = COUNTRY_DATASETS[countryCode];
  if (dataset) {
    return Object.keys(dataset).sort();
  }
  return [];
}

// Get cities for a state, sorted alphabetically
function getCities(countryCode, state) {
  const dataset = COUNTRY_DATASETS[countryCode];
  if (dataset && dataset[state]) {
    return [...dataset[state]].sort();
  }
  return [];
}

export { COUNTRIES, INDIA_STATES_CITIES, getStates, getCities };
