<?php
/**
 * Plugin Name:       Boracay Booking Widget
 * Description:       A check-in / check-out date picker with live nightly rates for properties on the Boracay.io booking platform. Sends guests to the property's booking engine with their dates already filled in. Add it with the [boracay_booking] shortcode.
 * Version:           1.2.1
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Boracay.io
 * License:           GPL-2.0-or-later
 * Text Domain:       boracay-booking
 * Update URI:        https://github.com/techsupportboracay/boracay-booking-widget
 */

defined('ABSPATH') || exit;

define('BKW_BOOKING_VERSION', '1.2.1');
define('BKW_BOOKING_OPTION', 'bkw_booking_options');

// ─── Self-updates from GitHub ────────────────────────────────────────────────
// This plugin isn't on wordpress.org, so WP has no way to notice new releases
// on its own. Plugin Update Checker (vendored below, MIT licensed) polls the
// GitHub repo's releases and, when the tagged version is newer than
// BKW_BOOKING_VERSION, plugs into the normal wp-admin "Update available"
// flow. https://github.com/YahnisElsts/plugin-update-checker
require_once __DIR__ . '/plugin-update-checker/plugin-update-checker.php';

use YahnisElsts\PluginUpdateChecker\v5\PucFactory;

$bkwUpdateChecker = PucFactory::buildUpdateChecker(
    'https://github.com/techsupportboracay/boracay-booking-widget/',
    __FILE__,
    'boracay-booking-widget'
);
$bkwUpdateChecker->setBranch('main');
// Install the zip attached to the GitHub Release (built with plugin-update-checker/
// and vendor deps already in place) instead of a raw checkout of the repo.
$bkwUpdateChecker->getVcsApi()->enableReleaseAssets('/\.zip($|[?&#])/i');

/**
 * Out-of-the-box values. Only the property slug has to be set per site; the
 * booking address and minimum stay are read from the platform unless
 * overridden ('booking_url' blank, 'min_nights' 0 = automatic).
 */
function bkw_booking_defaults() {
    return array(
        'slug'        => '',
        'api_url'     => 'https://reservations.boracay.io',
        'booking_url' => '',
        'min_nights'  => 0,
        'max_guests'  => 8,
        'button_text' => 'Check Availability',
        'accent'      => '#1a1814',
        'highlight'   => '#8b6a3e',
        'open_in'     => 'same',
    );
}

function bkw_booking_options() {
    $saved = get_option(BKW_BOOKING_OPTION, array());
    return wp_parse_args(is_array($saved) ? $saved : array(), bkw_booking_defaults());
}

/**
 * Validates a set of options, falling back per-field. Shared by the settings
 * page and the shortcode so both accept exactly the same values.
 */
function bkw_booking_clean($input, $fallback) {
    $input = is_array($input) ? $input : array();
    $out   = array();

    $slug = isset($input['slug']) ? sanitize_title($input['slug']) : '';
    $out['slug'] = $slug !== '' ? $slug : $fallback['slug'];

    $api = isset($input['api_url']) ? esc_url_raw(trim($input['api_url']), array('https', 'http')) : '';
    $out['api_url'] = $api !== '' ? $api : $fallback['api_url'];

    // Optional: blank means "use the address the platform reports for this property".
    if (isset($input['booking_url'])) {
        $out['booking_url'] = trim($input['booking_url']) === ''
            ? ''
            : esc_url_raw(trim($input['booking_url']), array('https', 'http'));
    } else {
        $out['booking_url'] = $fallback['booking_url'];
    }

    // 0 = automatic (the property's own minimum stay).
    $out['min_nights'] = isset($input['min_nights']) && is_numeric($input['min_nights'])
        ? max(0, min(30, (int) $input['min_nights']))
        : (int) $fallback['min_nights'];

    $out['max_guests'] = isset($input['max_guests']) && (int) $input['max_guests'] > 0
        ? min(20, (int) $input['max_guests'])
        : (int) $fallback['max_guests'];

    $text = isset($input['button_text']) ? sanitize_text_field($input['button_text']) : '';
    $out['button_text'] = $text !== '' ? $text : $fallback['button_text'];

    foreach (array('accent', 'highlight') as $key) {
        $hex = isset($input[$key]) ? sanitize_hex_color($input[$key]) : null;
        $out[$key] = $hex ? $hex : $fallback[$key];
    }

    $open = isset($input['open_in']) ? $input['open_in'] : '';
    $out['open_in'] = in_array($open, array('same', 'new'), true) ? $open : $fallback['open_in'];

    return $out;
}

// ─── Shortcode ────────────────────────────────────────────────────────────────

add_action('init', function () {
    $base = plugin_dir_url(__FILE__) . 'assets/';
    wp_register_style('bkw-booking', $base . 'widget.css', array(), BKW_BOOKING_VERSION);
    wp_register_script('bkw-booking', $base . 'widget.js', array(), BKW_BOOKING_VERSION, true);
});

function bkw_booking_shortcode($atts) {
    $saved = bkw_booking_options();
    $atts  = shortcode_atts(array_merge($saved, array('class' => '')), $atts, 'boracay_booking');
    $o     = bkw_booking_clean($atts, $saved);

    if ($o['slug'] === '') {
        // Visitors see nothing; whoever can fix it is told how.
        return current_user_can('manage_options')
            ? '<p><strong>Boracay Booking Widget:</strong> set the property slug under Settings &rarr; Boracay Booking (or use <code>[boracay_booking slug="your-property"]</code>).</p>'
            : '';
    }

    // Only load the assets on pages that actually use the widget.
    wp_enqueue_style('bkw-booking');
    wp_enqueue_script('bkw-booking');

    $config = array(
        'slug'       => $o['slug'],
        'apiUrl'     => $o['api_url'],
        'bookingUrl' => $o['booking_url'],
        'minNights'  => $o['min_nights'],
        'maxGuests'  => $o['max_guests'],
        'buttonText' => $o['button_text'],
        'openIn'     => $o['open_in'],
    );

    $classes = array('bkw');
    foreach (preg_split('/\s+/', trim((string) $atts['class'])) as $extra) {
        if ($extra !== '') {
            $classes[] = sanitize_html_class($extra);
        }
    }

    // The script builds the widget; without JS, visitors still get a working link.
    $fallback = $o['booking_url'] !== '' ? $o['booking_url'] : trailingslashit($o['api_url']) . $o['slug'];

    return sprintf(
        '<div class="%1$s" style="--bkw-accent:%2$s;--bkw-hl:%3$s" data-bkw-config="%4$s"><noscript><a class="bkw-go" href="%5$s">%6$s</a></noscript></div>',
        esc_attr(implode(' ', $classes)),
        esc_attr($o['accent']),
        esc_attr($o['highlight']),
        esc_attr(wp_json_encode($config)),
        esc_url($fallback),
        esc_html($o['button_text'])
    );
}
add_shortcode('boracay_booking', 'bkw_booking_shortcode');
// Kept so pages built with the plugin's first release keep working.
add_shortcode('sevenstones_booking', 'bkw_booking_shortcode');

// ─── Settings page (Settings → Boracay Booking) ───────────────────────────────

add_action('admin_init', function () {
    register_setting('bkw_booking', BKW_BOOKING_OPTION, array(
        'type'              => 'array',
        'sanitize_callback' => function ($input) {
            return bkw_booking_clean($input, bkw_booking_defaults());
        },
        'default'           => bkw_booking_defaults(),
    ));
});

add_action('admin_menu', function () {
    add_options_page(
        'Boracay Booking Widget',
        'Boracay Booking',
        'manage_options',
        'bkw-booking',
        'bkw_booking_settings_page'
    );
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=bkw-booking')) . '">Settings</a>');
    return $links;
});

function bkw_booking_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $o    = bkw_booking_options();
    $name = BKW_BOOKING_OPTION;
    ?>
    <div class="wrap">
        <h1>Boracay Booking Widget</h1>

        <p>Add the widget to any page, post or Elementor <em>Shortcode</em> widget with:</p>
        <p><code>[boracay_booking]</code></p>

        <form method="post" action="options.php">
            <?php settings_fields('bkw_booking'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="bkw_slug">Property slug</label></th>
                    <td>
                        <input type="text" id="bkw_slug" class="regular-text" name="<?php echo esc_attr($name); ?>[slug]" value="<?php echo esc_attr($o['slug']); ?>" placeholder="e.g. 7stones-boracay">
                        <p class="description">
                            The property's slug on the booking platform (the last part of its
                            <code>reservations.boracay.io/…</code> address). This is the only required setting.
                            Prices, the minimum stay and the booking address are all taken from it.
                        </p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_max_guests">Maximum guests</label></th>
                    <td><input type="number" id="bkw_max_guests" min="1" max="20" name="<?php echo esc_attr($name); ?>[max_guests]" value="<?php echo esc_attr($o['max_guests']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_button_text">Button text</label></th>
                    <td><input type="text" id="bkw_button_text" class="regular-text" name="<?php echo esc_attr($name); ?>[button_text]" value="<?php echo esc_attr($o['button_text']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_accent">Button &amp; selected-day colour</label></th>
                    <td><input type="color" id="bkw_accent" name="<?php echo esc_attr($name); ?>[accent]" value="<?php echo esc_attr($o['accent']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_highlight">Highlight colour</label></th>
                    <td><input type="color" id="bkw_highlight" name="<?php echo esc_attr($name); ?>[highlight]" value="<?php echo esc_attr($o['highlight']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_open_in">Open booking site</label></th>
                    <td>
                        <select id="bkw_open_in" name="<?php echo esc_attr($name); ?>[open_in]">
                            <option value="same" <?php selected($o['open_in'], 'same'); ?>>In the same tab</option>
                            <option value="new" <?php selected($o['open_in'], 'new'); ?>>In a new tab</option>
                        </select>
                    </td>
                </tr>
            </table>

            <h2>Advanced</h2>
            <p class="description">Leave these alone unless you need to override what the platform reports.</p>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="bkw_booking_url">Booking site URL</label></th>
                    <td>
                        <input type="url" id="bkw_booking_url" class="regular-text" name="<?php echo esc_attr($name); ?>[booking_url]" value="<?php echo esc_attr($o['booking_url']); ?>" placeholder="Automatic">
                        <p class="description">Blank = the property's own address (its custom domain if it has one).</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_min_nights">Minimum nights</label></th>
                    <td>
                        <input type="number" id="bkw_min_nights" min="0" max="30" name="<?php echo esc_attr($name); ?>[min_nights]" value="<?php echo esc_attr($o['min_nights']); ?>">
                        <p class="description">0 = automatic (the property's own minimum stay).</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="bkw_api_url">Booking platform URL</label></th>
                    <td>
                        <input type="url" id="bkw_api_url" class="regular-text" name="<?php echo esc_attr($name); ?>[api_url]" value="<?php echo esc_attr($o['api_url']); ?>">
                        <p class="description">Where prices are loaded from.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>

        <h2>More than one property on this site</h2>
        <p>Give each placement its own slug; every other setting above can be overridden the same way:</p>
        <p><code>[boracay_booking slug="the-ronin" button_text="Book The Ronin"]</code></p>
        <p>Available attributes: <code>slug</code>, <code>max_guests</code>, <code>button_text</code>, <code>accent</code>, <code>highlight</code>, <code>open_in</code>, <code>booking_url</code>, <code>min_nights</code>, <code>api_url</code>, <code>class</code>.</p>
    </div>
    <?php
}
