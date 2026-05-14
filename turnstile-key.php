<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$envConfig = @parse_ini_file(__DIR__ . '/.env') ?: [];
$siteKey = $envConfig['VITE_TURNSTILE_SITE_KEY'] ?? '';

echo json_encode(['siteKey' => $siteKey]);
