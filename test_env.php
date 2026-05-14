<?php
$envConfig = @parse_ini_file(__DIR__ . '/.env', false, INI_SCANNER_RAW) ?: [];
echo "Token: [" . ($envConfig['MAP2WEB_SERVICE_TOKEN'] ?? 'NOT FOUND') . "]\n";
echo "Origin: [" . ($envConfig['MAP2WEB_ORIGIN'] ?? 'NOT FOUND') . "]\n";
