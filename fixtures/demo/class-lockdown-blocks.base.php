<?php
/**
 * Lockdown Blocks — WordPress mu-plugin
 *
 * Renders the front-end lockdown banner + FAQ accordion for users that
 * hit a paywall on protected blog posts.
 *
 * @package Mirage\Lockdown
 */

namespace Mirage\Lockdown\Blocks;

use Mirage\Cache\CacheInterface;
use Mirage\Logging\Logger;
use Mirage\Http\Request;
use Mirage\Http\Response;

class Mirage_Lockdown_Blocks {

    /** @var CacheInterface */
    private $cache;

    /** @var Logger */
    private $logger;

    public function __construct( CacheInterface $cache, Logger $logger ) {
        $this->cache = $cache;
        $this->logger = $logger;
    }

    public function register_scripts(): void {
        foreach ( $this->frontend_handles() as $handle => $config ) {
            if ( ! wp_script_is( $handle, 'registered' ) ) {
                wp_register_script(
                    $handle,
                    plugins_url( $config['path'], __FILE__ ),
                    $config['deps'] ?? [],
                    $config['version'] ?? '1.0.0',
                    true
                );
            }
        }
    }

    public function enqueue_assets(): void {
        wp_enqueue_style( 'lockdown-blocks', plugins_url( 'css/blocks.css', __FILE__ ) );
        wp_enqueue_script( 'lockdown-blocks' );
        wp_localize_script( 'lockdown-blocks', 'lockdownConfig', $this->localized_config() );
    }

    public function render_faq_items_section( array $posts ): string {
        if ( empty( $posts ) ) return '';
        $grammar = '';
        foreach ( $posts as $post ) {
            $title   = esc_html( $post->post_title );
            $excerpt = esc_html( self::faq_excerpt( $post ) );
            $link    = esc_url( get_permalink( $post ) );
            $grammar .= <<<BLOCK
<details class="faq-item">
    <summary>{$title}</summary>
    <div>{$excerpt}</div>
    <a href="{$link}">Read more</a>
</details>
BLOCK;
        }
        return $grammar;
    }

    public function render_faq_single_hero( $post ): string {
        return <<<HTML
<section class="faq-hero">
    <h1>{$post->post_title}</h1>
    <p>{$post->post_excerpt}</p>
</section>
HTML;
    }

    private static function faq_excerpt( $post ): string {
        if ( ! empty( $post->post_excerpt ) ) {
            return wp_trim_words( $post->post_excerpt, 24, '…' );
        }
        return wp_trim_words( strip_shortcodes( $post->post_content ), 24, '…' );
    }

    public function render_lockdown_banner( int $post_id ): string {
        $title   = get_the_title( $post_id );
        $message = $this->banner_message( $post_id );
        return sprintf(
            '<aside class="lockdown-banner" data-post-id="%d"><h2>%s</h2><p>%s</p></aside>',
            $post_id,
            esc_html( $title ),
            wp_kses_post( $message )
        );
    }

    private function banner_message( int $post_id ): string {
        $message = (string) get_post_meta( $post_id, '_lockdown_banner_message', true );
        if ( $message !== '' ) return $message;
        return __( 'This post is locked. Subscribe to keep reading.', 'mirage-lockdown' );
    }

    private function frontend_handles(): array {
        return [
            'lockdown-blocks' => [
                'path'    => 'js/blocks.js',
                'deps'    => [ 'wp-element' ],
                'version' => '2.4.1',
            ],
            'lockdown-faq' => [
                'path'    => 'js/faq.js',
                'deps'    => [ 'jquery' ],
                'version' => '2.4.1',
            ],
        ];
    }

    private function localized_config(): array {
        return [
            'restRoot' => esc_url_raw( rest_url() ),
            'nonce'    => wp_create_nonce( 'wp_rest' ),
            'i18n'     => [
                'subscribe'   => __( 'Subscribe', 'mirage-lockdown' ),
                'already_in'  => __( 'Already a member?', 'mirage-lockdown' ),
                'login'       => __( 'Log in', 'mirage-lockdown' ),
            ],
        ];
    }

    public function fetch_recent_posts( int $limit ): array {
        $args = [
            'post_type'      => 'post',
            'posts_per_page' => $limit,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ];
        $query = new \WP_Query( $args );
        return $query->posts;
    }

    public function fetch_related_posts( int $post_id, int $limit ): array {
        $cache_key = sprintf( 'lockdown_related_%d_%d', $post_id, $limit );
        $cached = $this->cache->get( $cache_key );
        if ( is_array( $cached ) ) return $cached;
        $args = [
            'post_type'      => 'post',
            'posts_per_page' => $limit,
            'post__not_in'   => [ $post_id ],
            'orderby'        => 'rand',
        ];
        $query = new \WP_Query( $args );
        $this->cache->set( $cache_key, $query->posts, 600 );
        return $query->posts;
    }

    public function track_view( int $post_id, int $user_id ): void {
        $count = (int) get_post_meta( $post_id, '_lockdown_view_count', true );
        update_post_meta( $post_id, '_lockdown_view_count', $count + 1 );
        $this->logger->info(
            sprintf( 'lockdown: user %d viewed post %d', $user_id, $post_id )
        );
    }

    public function track_paywall_hit( int $post_id, int $user_id ): void {
        $count = (int) get_post_meta( $post_id, '_lockdown_paywall_hits', true );
        update_post_meta( $post_id, '_lockdown_paywall_hits', $count + 1 );
        $this->logger->info(
            sprintf( 'lockdown: user %d hit paywall on post %d', $user_id, $post_id )
        );
    }

    public function track_subscription_conversion( int $post_id, int $user_id, string $plan ): void {
        $this->logger->info( sprintf(
            'lockdown: user %d converted on post %d (plan: %s)',
            $user_id,
            $post_id,
            $plan
        ) );
    }

    public function clear_cache_for_post( int $post_id ): void {
        $this->cache->delete( sprintf( 'lockdown_meta_%d', $post_id ) );
        $this->cache->delete( sprintf( 'lockdown_banner_%d', $post_id ) );
    }

    public function render_subscription_form(): string {
        ob_start();
        ?>
        <form class="lockdown-subscribe" method="post" action="<?php echo esc_url( rest_url( 'mirage/v1/subscribe' ) ); ?>">
            <label>
                <span><?php esc_html_e( 'Email', 'mirage-lockdown' ); ?></span>
                <input type="email" name="email" required />
            </label>
            <button type="submit"><?php esc_html_e( 'Subscribe', 'mirage-lockdown' ); ?></button>
        </form>
        <?php
        return (string) ob_get_clean();
    }

    public function maybe_inject_inline_styles(): void {
        if ( ! is_singular( 'post' ) ) return;
        if ( ! function_exists( 'wp_add_inline_style' ) ) return;
        wp_add_inline_style( 'lockdown-blocks', $this->inline_styles() );
    }

    private function inline_styles(): string {
        return '.lockdown-banner{padding:24px;background:#f5f5f5;border-radius:6px;}'
            . '.faq-item{margin:12px 0;border-bottom:1px solid #eee;}'
            . '.lockdown-subscribe input{display:block;margin:8px 0;padding:6px 8px;}';
    }

    public function handle_rest_subscribe( Request $request ): Response {
        $email = sanitize_email( (string) $request->get_param( 'email' ) );
        if ( ! is_email( $email ) ) {
            return new Response( wp_json_encode( [ 'error' => 'invalid email' ] ), 400 );
        }
        $payload = [ 'status' => 'ok', 'email' => $email ];
        return new Response( wp_json_encode( $payload ), 200 );
    }

    public function handle_rest_unsubscribe( Request $request ): Response {
        $email = sanitize_email( (string) $request->get_param( 'email' ) );
        if ( ! is_email( $email ) ) {
            return new Response( wp_json_encode( [ 'error' => 'invalid email' ] ), 400 );
        }
        return new Response( wp_json_encode( [ 'status' => 'ok' ] ), 200 );
    }

    public function register_rest_routes(): void {
        register_rest_route( 'mirage/v1', '/subscribe', [
            'methods'  => 'POST',
            'callback' => [ $this, 'handle_rest_subscribe' ],
            'permission_callback' => '__return_true',
        ] );
        register_rest_route( 'mirage/v1', '/unsubscribe', [
            'methods'  => 'POST',
            'callback' => [ $this, 'handle_rest_unsubscribe' ],
            'permission_callback' => '__return_true',
        ] );
    }

    public function flush_cache_on_save( int $post_id ): void {
        $this->cache->delete( 'lockdown_recent_posts' );
        $this->clear_cache_for_post( $post_id );
    }

    public function format_bytes( int $bytes ): string {
        $units  = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
        $factor = (int) floor( ( strlen( (string) $bytes ) - 1 ) / 3 );
        return sprintf( '%.2f %s', $bytes / pow( 1024, $factor ), $units[ $factor ] );
    }

    public function slugify( string $text ): string {
        $text = preg_replace( '~[^\pL\d]+~u', '-', $text );
        $text = iconv( 'utf-8', 'us-ascii//TRANSLIT', $text );
        $text = preg_replace( '~[^-\w]+~', '', $text );
        return strtolower( trim( $text, '-' ) );
    }

    public function data_url( string $mime, string $payload ): string {
        return 'data:' . $mime . ';base64,' . base64_encode( $payload );
    }

    private static function faq_excerpt_for_block( $post, int $words = 24 ): string {
        $candidate = ! empty( $post->post_excerpt ) ? $post->post_excerpt : $post->post_content;
        return wp_trim_words( strip_shortcodes( $candidate ), $words, '…' );
    }

    public function get_view_count( int $post_id ): int {
        return (int) get_post_meta( $post_id, '_lockdown_view_count', true );
    }

    public function get_paywall_hits( int $post_id ): int {
        return (int) get_post_meta( $post_id, '_lockdown_paywall_hits', true );
    }

    public function get_subscription_stats(): array {
        return [
            'subscribers' => $this->cache->get( 'lockdown_subscribers_total' ) ?: 0,
            'churn'       => $this->cache->get( 'lockdown_churn_rate' ) ?: 0.0,
        ];
    }

    private function localized_strings(): array {
        return [
            'subscribe'   => __( 'Subscribe', 'mirage-lockdown' ),
            'already_in'  => __( 'Already a member?', 'mirage-lockdown' ),
            'login'       => __( 'Log in', 'mirage-lockdown' ),
            'cancel'      => __( 'Cancel', 'mirage-lockdown' ),
            'continue'    => __( 'Continue reading', 'mirage-lockdown' ),
        ];
    }
}
