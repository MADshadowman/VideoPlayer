<?php

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

error_reporting(E_ALL);
@ini_set('display_errors', '0');

try {
    $baseDir = rtrim(__DIR__, '/\\') . DIRECTORY_SEPARATOR . 'videos';
    $posterDir = $baseDir . DIRECTORY_SEPARATOR . 'posters';

    if (!is_dir($baseDir)) {
        output_json(array('videos' => array()));
        exit;
    }

    $videoExt = array('mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv');
    $posterExt = array('jpg', 'jpeg', 'png', 'webp');
    $mimeByExt = array(
        'mp4' => 'video/mp4',
        'm4v' => 'video/mp4',
        'webm' => 'video/webm',
        'mov' => 'video/quicktime',
        'ogg' => 'video/ogg',
        'ogv' => 'video/ogg',
        'mkv' => 'video/x-matroska',
    );

    $groups = array();
    scan_video_tree($baseDir, '', $videoExt, $mimeByExt, $groups);

    $videos = array();
    foreach ($groups as $stem => $sources) {
        usort($sources, 'compare_sources_by_priority');

        $firstSource = $sources[0];
        $baseName = pathinfo($stem, PATHINFO_BASENAME);
        $title = humanize_title($baseName);

        $totalSize = 0;
        $oldest = null;
        foreach ($sources as $source) {
            $totalSize += (int) $source['sizeBytes'];
            $ts = (int) $source['mtime'];
            if ($oldest === null || $ts < $oldest) {
                $oldest = $ts;
            }
        }

        $poster = find_poster_for_stem($posterDir, $stem, $posterExt);

        $minimalSources = array();
        foreach ($sources as $src) {
            $minimalSources[] = array(
                'src' => $src['src'],
                'type' => $src['type'],
                'label' => $src['label'],
                'sizeBytes' => (int) $src['sizeBytes'],
                'modifiedAt' => date('c', (int) $src['mtime']),
            );
        }

        $videos[] = array(
            'id' => slugify($stem),
            'title' => $title,
            'poster' => $poster,
            'duration' => 0,
            'resolution' => '',
            'codec' => '',
            'sizeBytes' => $totalSize,
            'createdAt' => $oldest ? date('Y-m-d', $oldest) : '',
            'tags' => array(strtolower((string) pathinfo($firstSource['src'], PATHINFO_EXTENSION))),
            'sources' => $minimalSources,
        );
    }

    usort($videos, 'compare_videos_by_title');

    output_json(array('videos' => $videos));
} catch (Exception $e) {
    http_response_code(500);
    output_json(array(
        'videos' => array(),
        'error' => 'videos.php failed: ' . $e->getMessage(),
        'php_version' => PHP_VERSION,
    ));
}

function scan_video_tree($baseDir, $relativeDir, $videoExt, $mimeByExt, &$groups)
{
    $target = $baseDir . ($relativeDir !== '' ? DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativeDir) : '');
    $items = @scandir($target);
    if ($items === false) {
        return;
    }

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }

        $nextRelative = $relativeDir !== '' ? $relativeDir . '/' . $item : $item;

        if (strpos(str_replace('\\', '/', $nextRelative), 'posters/') === 0) {
            continue;
        }

        $absolute = $target . DIRECTORY_SEPARATOR . $item;

        if (is_dir($absolute)) {
            scan_video_tree($baseDir, $nextRelative, $videoExt, $mimeByExt, $groups);
            continue;
        }

        if (!is_file($absolute)) {
            continue;
        }

        $ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
        if (!in_array($ext, $videoExt, true)) {
            continue;
        }

        $stem = preg_replace('/\.[^.]+$/', '', $nextRelative);
        $srcPath = 'videos/' . encode_path_segments($nextRelative);
        $label = strtoupper($ext) . ' source';

        if (!isset($groups[$stem])) {
            $groups[$stem] = array();
        }

        $groups[$stem][] = array(
            'src' => $srcPath,
            'type' => isset($mimeByExt[$ext]) ? $mimeByExt[$ext] : '',
            'label' => $label,
            'sizeBytes' => (int) @filesize($absolute),
            'mtime' => (int) @filemtime($absolute),
        );
    }
}

function compare_sources_by_priority($a, $b)
{
    $pa = source_priority($a['src']);
    $pb = source_priority($b['src']);

    if ($pa === $pb) {
        return strcmp($a['src'], $b['src']);
    }

    return ($pa < $pb) ? -1 : 1;
}

function source_priority($src)
{
    $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION));

    if ($ext === 'mp4') {
        return 0;
    }
    if ($ext === 'webm') {
        return 1;
    }
    if ($ext === 'ogg' || $ext === 'ogv') {
        return 2;
    }
    if ($ext === 'mov') {
        return 3;
    }
    if ($ext === 'mkv') {
        return 4;
    }

    return 99;
}

function compare_videos_by_title($a, $b)
{
    return strcasecmp((string) $a['title'], (string) $b['title']);
}

function find_poster_for_stem($posterDir, $stem, $posterExt)
{
    if (!is_dir($posterDir)) {
        return '';
    }

    $base = pathinfo($stem, PATHINFO_BASENAME);
    foreach ($posterExt as $ext) {
        $candidate = $posterDir . DIRECTORY_SEPARATOR . $base . '.' . $ext;
        if (is_file($candidate)) {
            return 'videos/posters/' . rawurlencode($base . '.' . $ext);
        }
    }

    return '';
}

function humanize_title($value)
{
    $title = preg_replace('/[._-]+/', ' ', $value);
    if ($title === null) {
        $title = $value;
    }
    $title = trim(preg_replace('/\s+/', ' ', $title));

    if (function_exists('mb_convert_case')) {
        return mb_convert_case($title, MB_CASE_TITLE, 'UTF-8');
    }

    return ucwords(strtolower($title));
}

function slugify($value)
{
    $value = strtolower((string) $value);
    $slug = preg_replace('/[^a-z0-9]+/', '-', $value);
    if ($slug === null) {
        $slug = $value;
    }

    return trim($slug, '-');
}

function encode_path_segments($path)
{
    $path = str_replace('\\', '/', $path);
    $parts = explode('/', $path);
    $encoded = array();

    foreach ($parts as $part) {
        $encoded[] = rawurlencode($part);
    }

    return implode('/', $encoded);
}

function output_json($payload)
{
    $json = json_encode($payload);
    if ($json === false) {
        http_response_code(500);
        echo '{"videos":[],"error":"json_encode failed"}';
        return;
    }

    echo $json;
}
