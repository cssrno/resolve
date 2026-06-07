<?php
namespace Demo\Fixtures;

use Demo\Database\Connection;
use Demo\Http\Request;
use Demo\Http\Response;
use Demo\Logging\Logger;
use Demo\Cache\CacheInterface;

class LongFile {
<<<<<<< HEAD
    public function methodA() {
        return 'local-a';
    }
|||||||
    public function methodA() {
        return 'base-a';
    }
=======
    public function methodA() {
        return 'remote-a';
    }
>>>>>>> branch

    public function helperOne() {
        $value = 1;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperTwo() {
        $value = 2;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperThree() {
        $value = 3;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperFour() {
        $value = 4;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperFive() {
        $value = 5;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperSix() {
        $value = 6;
        $doubled = $value * 2;
        return $doubled;
    }

<<<<<<< HEAD
    public function methodLocalAdd() {
        return 'only-on-local';
    }

|||||||
=======
>>>>>>> branch
    public function helperSeven() {
        $value = 7;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperEight() {
        $value = 8;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperNine() {
        $value = 9;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperTen() {
        $value = 10;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperEleven() {
        $value = 11;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperTwelve() {
        $value = 12;
        $doubled = $value * 2;
        return $doubled;
    }

<<<<<<< HEAD
    public function methodLocalMod() {
        $rewritten = 'by-local';
        return $rewritten;
    }
|||||||
    public function methodLocalMod() {
        $rewritten = 'base-value';
        return $rewritten;
    }
=======
    public function methodLocalMod() {
        $rewritten = 'base-value';
        return $rewritten;
    }
>>>>>>> branch

    public function helperThirteen() {
        $value = 13;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperFourteen() {
        $value = 14;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperFifteen() {
        $value = 15;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperSixteen() {
        $value = 16;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperSeventeen() {
        $value = 17;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperEighteen() {
        $value = 18;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperNineteen() {
        $value = 19;
        $doubled = $value * 2;
        return $doubled;
    }

    public function helperTwenty() {
        $value = 20;
        $doubled = $value * 2;
        return $doubled;
    }

<<<<<<< HEAD
    public function methodRemoteMod() {
        $value = 'base-original';
        return $value;
    }
|||||||
    public function methodRemoteMod() {
        $value = 'base-original';
        return $value;
    }
=======
    public function methodRemoteMod() {
        $value = 'rewritten-by-remote';
        return $value;
    }
>>>>>>> branch

    public function buildResponse(Request $request): Response {
        $payload = ['status' => 'ok'];
        return new Response(json_encode($payload), 200);
    }

    public function fetchUser(int $userId): ?array {
        $row = Connection::query('SELECT * FROM users WHERE id = ?', [$userId]);
        if (!$row) return null;
        return $row;
    }

    public function fetchOrders(int $userId): array {
        $rows = Connection::query('SELECT * FROM orders WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchInvoices(int $userId): array {
        $rows = Connection::query('SELECT * FROM invoices WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchPayments(int $userId): array {
        $rows = Connection::query('SELECT * FROM payments WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

<<<<<<< HEAD
    public function methodLocalDel() {
        $tmp = 'still-here-on-local';
        return $tmp;
    }
|||||||
    public function methodLocalDel() {
        $tmp = 'still-here-on-local';
        return $tmp;
    }
=======
>>>>>>> branch

    public function fetchSubscriptions(int $userId): array {
        $rows = Connection::query('SELECT * FROM subscriptions WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchNotifications(int $userId): array {
        $rows = Connection::query('SELECT * FROM notifications WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchAuditLogs(int $userId): array {
        $rows = Connection::query('SELECT * FROM audit_logs WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchPreferences(int $userId): array {
        $rows = Connection::query('SELECT * FROM preferences WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchAddresses(int $userId): array {
        $rows = Connection::query('SELECT * FROM addresses WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function fetchPaymentMethods(int $userId): array {
        $rows = Connection::query('SELECT * FROM payment_methods WHERE user_id = ?', [$userId]);
        return $rows ?: [];
    }

    public function logAccess(int $userId, string $resource): void {
        Logger::info("user {$userId} accessed {$resource}");
    }

    public function logError(int $userId, string $message): void {
        Logger::error("user {$userId} hit error: {$message}");
    }

    public function logWarning(int $userId, string $message): void {
        Logger::warning("user {$userId} warning: {$message}");
    }

    public function logDebug(int $userId, string $message): void {
        Logger::debug("user {$userId} debug: {$message}");
    }

<<<<<<< HEAD
    public function methodC() {
        return 'local-c';
    }
|||||||
    public function methodC() {
        return 'base-c';
    }
=======
    public function methodC() {
        return 'remote-c';
    }
>>>>>>> branch

    public function cacheGet(string $key, CacheInterface $cache): mixed {
        return $cache->get($key);
    }

    public function cacheSet(string $key, mixed $value, CacheInterface $cache, int $ttl = 3600): void {
        $cache->set($key, $value, $ttl);
    }

    public function cacheDelete(string $key, CacheInterface $cache): void {
        $cache->delete($key);
    }

    public function cacheFlush(CacheInterface $cache): void {
        $cache->flush();
    }

    public function cacheHas(string $key, CacheInterface $cache): bool {
        return $cache->has($key);
    }

    public function cacheIncrement(string $key, CacheInterface $cache, int $by = 1): int {
        return $cache->increment($key, $by);
    }

    public function cacheDecrement(string $key, CacheInterface $cache, int $by = 1): int {
        return $cache->decrement($key, $by);
    }

    public function cacheRemember(string $key, callable $producer, CacheInterface $cache, int $ttl = 3600): mixed {
        if ($cache->has($key)) return $cache->get($key);
        $value = $producer();
        $cache->set($key, $value, $ttl);
        return $value;
    }

    public function formatBytes(int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $factor = floor((strlen((string) $bytes) - 1) / 3);
        return sprintf('%.2f %s', $bytes / pow(1024, $factor), $units[$factor]);
    }

    public function slugify(string $text): string {
        $text = preg_replace('~[^\pL\d]+~u', '-', $text);
        $text = iconv('utf-8', 'us-ascii//TRANSLIT', $text);
        $text = preg_replace('~[^-\w]+~', '', $text);
        return strtolower(trim($text, '-'));
    }

    public function dataUrl(string $mime, string $payload): string {
        return 'data:' . $mime . ';base64,' . base64_encode($payload);
    }
}
