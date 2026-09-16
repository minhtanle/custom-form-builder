<?php

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/validate_form.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || trim($rawBody) === '') {
        throw new InvalidArgumentException('Request body is empty.');
    }

    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) {
        throw new InvalidArgumentException('Request body must be a valid JSON object.');
    }

    $schemaPath = dirname(__DIR__) . '/examples/data/schema.json';
    $validation = vraceValidateFormData($payload, $schemaPath);

    if ($validation['ok']) {
        echo json_encode([
            'ok' => true,
            'errors' => [],
            'data' => $payload,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    http_response_code(422);
    echo json_encode([
        'ok' => false,
        'errors' => $validation['errors'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'errors' => [[
            'field' => '',
            'code' => 'request_invalid',
            'message' => $e->getMessage(),
        ]],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
