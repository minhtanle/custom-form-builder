<?php

declare(strict_types=1);

/**
 * Validate submitted form data against a JSON schema file.
 *
 * Return format:
 * [
 *   'ok' => bool,
 *   'errors' => [
 *     ['field' => string, 'code' => string, 'message' => string]
 *   ]
 * ]
 */
function csValidateFormData(array $data, string $schemaPath): array
{
    $schema = csLoadSchema($schemaPath);

    if (!class_exists('Opis\\JsonSchema\\Validator')) {
        return [
            'ok' => false,
            'errors' => [
                [
                    'field' => '',
                    'code' => 'validator_missing',
                    'message' => 'Missing dependency opis/json-schema. Run: composer install in php directory.'
                ]
            ]
        ];
    }

    $validator = new \Opis\JsonSchema\Validator();
    if (method_exists($validator, 'setMaxErrors')) {
        $validator->setMaxErrors(50);
    }
    if (method_exists($validator, 'setStopAtFirstError')) {
        $validator->setStopAtFirstError(false);
    }
    $result = csRunValidation($validator, $data, $schema);
    $rangeErrors = csCheckDateRanges($data, $schema);

    if ($result === true) {
        return ['ok' => count($rangeErrors) === 0, 'errors' => $rangeErrors];
    }

    $errors = array_merge(csCollectErrors($result), $rangeErrors);

    return [
        'ok' => count($errors) === 0,
        'errors' => $errors,
    ];
}

/**
 * formatMinimum / formatMaximum (chuẩn ajv-formats, draft-07 không hỗ trợ
 * nên Opis bỏ qua) → tự kiểm tra ở đây để lớp PHP chặn giống hệt JS engine.
 *
 * @return array<int, array{field:string,code:string,message:string}>
 */
function csCheckDateRanges(array $data, object $schema): array
{
    $errors = [];
    $props = $schema->properties ?? null;
    if (!is_object($props)) {
        return $errors;
    }

    foreach (get_object_vars($props) as $field => $prop) {
        if (!is_object($prop) || ($prop->format ?? null) !== 'date') {
            continue;
        }
        $min = $prop->formatMinimum ?? null;
        $max = $prop->formatMaximum ?? null;
        if ($min === null && $max === null) {
            continue;
        }
        $val = $data[$field] ?? null;
        // Chỉ kiểm tra range cho ngày hợp lệ thực tế; ngày xấu để keyword format báo.
        if (!is_string($val) || $val === '') {
            continue;
        }
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $val, $m)
            || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            continue;
        }

        $tooLow = $min !== null && strcmp($val, $min) < 0;
        $tooHigh = $max !== null && !$tooLow && strcmp($val, $max) > 0;
        if (!$tooLow && !$tooHigh) {
            continue;
        }

        if ($min !== null && $max !== null) {
            $message = sprintf('[%s] date must be between %s and %s.', $field, $min, $max);
        } elseif ($min !== null) {
            $message = sprintf('[%s] date must not be earlier than %s.', $field, $min);
        } else {
            $message = sprintf('[%s] date must not be later than %s.', $field, $max);
        }
        $errors[] = ['field' => $field, 'code' => 'dateRange', 'message' => $message];
    }

    return $errors;
}

/**
 * @return object
 */
function csLoadSchema(string $schemaPath)
{
    if (!is_file($schemaPath)) {
        throw new InvalidArgumentException('Schema file not found: ' . $schemaPath);
    }

    $raw = file_get_contents($schemaPath);
    if ($raw === false) {
        throw new RuntimeException('Cannot read schema file: ' . $schemaPath);
    }

    $schema = json_decode($raw);
    if (!is_object($schema)) {
        throw new InvalidArgumentException('Invalid schema JSON in file: ' . $schemaPath);
    }

    return $schema;
}

/**
 * Wrapper that supports both common Opis APIs.
 *
 * @return bool|object
 */
function csRunValidation($validator, array $data, object $schema)
{
    if (method_exists($validator, 'validate')) {
        $validation = $validator->validate((object) $data, $schema);
        if (is_object($validation) && method_exists($validation, 'isValid') && $validation->isValid()) {
            return true;
        }
        return $validation;
    }

    if (method_exists($validator, 'schemaValidation')) {
        $validation = $validator->schemaValidation((object) $data, $schema);
        if (is_object($validation) && method_exists($validation, 'isValid') && $validation->isValid()) {
            return true;
        }
        return $validation;
    }

    throw new RuntimeException('Unsupported opis/json-schema validator API version.');
}

/**
 * @param object $validationResult
 * @return array<int, array{field:string,code:string,message:string}>
 */
function csCollectErrors(object $validationResult): array
{
    $errors = [];

    if (!method_exists($validationResult, 'error')) {
        return [[
            'field' => '',
            'code' => 'unknown',
            'message' => 'Validation failed but no error detail is available.'
        ]];
    }

    $rootError = $validationResult->error();
    if (!is_object($rootError)) {
        return [[
            'field' => '',
            'code' => 'unknown',
            'message' => 'Validation failed with unrecognized error payload.'
        ]];
    }

    csFlattenError($rootError, $errors);

    if (count($errors) === 0) {
        $errors[] = [
            'field' => '',
            'code' => 'invalid',
            'message' => 'Validation failed.'
        ];
    }

    return $errors;
}

/**
 * @param array<int, array{field:string,code:string,message:string}> $errors
 */
function csFlattenError($error, array &$errors, string $contextField = ''): void
{
    if (!is_object($error)) {
        return;
    }

    $keyword = method_exists($error, 'keyword') ? (string) $error->keyword() : 'invalid';
    $dataPointer = '';
    if (method_exists($error, 'dataPointer')) {
        $dataPointer = (string) $error->dataPointer();
    } elseif (method_exists($error, 'data')
        && is_object($error->data())
        && method_exists($error->data(), 'fullPath')
    ) {
        $fp = $error->data()->fullPath();
        $dataPointer = is_array($fp) ? implode('/', $fp) : (string) $fp;
    }
    $args = method_exists($error, 'args') ? (array) $error->args() : [];

    $field = csResolveField($keyword, $dataPointer, $args);
    if ($field === '' && $contextField !== '') {
        $field = $contextField;
    }

    // Keyword container (đánh dấu nhánh validate) chỉ để truyền ngữ cảnh field, không phải lỗi thực tế
    $container = in_array($keyword, ['allOf', 'anyOf', 'oneOf', 'then', 'else', 'if', 'not', 'properties'], true);
    if (!$container) {
        $deduped = false;
        foreach ($errors as $e) {
            if ($e['field'] === $field && $e['code'] === $keyword) {
                $deduped = true;
                break;
            }
        }
        if (!$deduped) {
            $errors[] = [
                'field' => $field,
                'code' => $keyword,
                'message' => csBuildMessage($keyword, $field, $args),
            ];
        }
    }

    if (method_exists($error, 'subErrors')) {
        $childContext = $field !== '' ? $field : $contextField;
        foreach ((array) $error->subErrors() as $subError) {
            if (is_object($subError)) {
                csFlattenError($subError, $errors, $childContext);
            }
        }
    }
}

/**
 * @param array<string, mixed> $args
 */
function csResolveField(string $keyword, string $dataPointer, array $args): string
{
    if ($keyword === 'required') {
        if (isset($args['missing']) && is_string($args['missing'])) {
            return $args['missing'];
        }
        if (isset($args['missing']) && is_array($args['missing']) && count($args['missing']) === 1 && is_string(reset($args['missing']))) {
            return reset($args['missing']);
        }
        if (isset($args['property']) && is_string($args['property'])) {
            return $args['property'];
        }
    }

    // Opis 2.6 không set dataPointer cho sub-error; tên field nằm trong args của keyword "properties"
    if ($keyword === 'properties') {
        $props = $args['properties'] ?? null;
        if (is_array($props)) {
            foreach ($props as $p) {
                if (is_string($p) && $p !== '') {
                    return $p;
                }
            }
        }
    }

    $segments = array_values(array_filter(explode('/', $dataPointer), static function ($segment) {
        return $segment !== '';
    }));

    if (count($segments) === 0) {
        return '';
    }

    return str_replace('~1', '/', str_replace('~0', '~', (string) end($segments)));
}

/**
 * @param array<string, mixed> $args
 */
function csBuildMessage(string $keyword, string $field, array $args): string
{
    $label = $field !== '' ? '[' . $field . ']' : 'payload';

    switch ($keyword) {
        case 'required':
            return $label . ' is required.';
        case 'type':
            return $label . ' has invalid type.';
        case 'enum':
            return $label . ' must be one of the allowed values.';
        case 'oneOf':
            return $label . ' must match exactly one of the allowed values.';
        case 'const':
            return $label . ' must match the expected value' . (isset($args['const']) && is_scalar($args['const']) ? ' [' . $args['const'] . ']' : '') . '.';
        case 'format':
            return $label . ' has invalid format.';
        case 'minLength':
            return $label . ' is shorter than minimum length.';
        case 'maxLength':
            return $label . ' is longer than maximum length.';
        case 'minimum':
            return $label . ' is less than minimum value.';
        case 'maximum':
            return $label . ' is greater than maximum value.';
        default:
            if (isset($args['message']) && is_string($args['message']) && $args['message'] !== '') {
                return $args['message'];
            }
            return $label . ' is invalid (' . $keyword . ').';
    }
}
