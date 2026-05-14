<?php
function sb_load_env() {
    $envConfig = [];
    $envPath = __DIR__ . '/.env';
    if (file_exists($envPath)) {
        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
            if (strpos($line, '=') === false) continue;
            list($name, $value) = explode('=', $line, 2) + [NULL, NULL];
            if ($name !== NULL && $value !== NULL) {
                $name = trim($name);
                $value = trim($value);
                // Remove surrounding quotes if present
                $value = preg_replace('/^["\'](.*)["\']$/', '$1', $value);
                $envConfig[$name] = $value;
            }
        }
    }
    return $envConfig;
}

$envConfig = sb_load_env();
echo "Token: [" . ($envConfig['MAP2WEB_SERVICE_TOKEN'] ?? 'NOT FOUND') . "]\n";
echo "Origin: [" . ($envConfig['MAP2WEB_ORIGIN'] ?? 'NOT FOUND') . "]\n";
