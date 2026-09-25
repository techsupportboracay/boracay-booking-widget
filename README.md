# Boracay Booking Widget

A WordPress plugin that adds a check-in / check-out widget to a property's own website.
Guests pick dates on a two-month calendar (with the cheapest nightly rate under each
day), choose guests, optionally enter a promo code, and are sent to the property's
booking engine with everything pre-filled:

```
https://bookings.7stonesboracay.com/?check_in=2026-10-05&check_out=2026-10-08&guests=2&agent_code=PROMO
```

Works for any property on the booking platform — the only per-property setting is its **slug**.

## Set up a new property (2 minutes)

1. Download the latest `boracay-booking-widget.zip` from
   [Releases](https://github.com/techsupportboracay/boracay-booking-widget/releases/latest) and
   upload it in **Plugins → Add New → Upload Plugin**, then activate.
2. **Settings → Boracay Booking** → enter the property slug (e.g. `7stones-boracay`, `the-ronin`)
   and pick colours / button text to match the site. Save.
3. Put `[boracay_booking]` where the widget should appear: a page, a post, or an
   Elementor **Shortcode** widget.

That's it. Prices, the minimum stay and the booking address come from the platform, so
nothing is duplicated on the WordPress site. If a property gets a custom domain later
(set in the platform admin), the widget starts sending guests there on its own.

That first install is the only manual step — from then on, wp-admin's **Plugins** page (and
**Dashboard → Updates**) shows a normal "Update available" notice whenever a new version is
tagged here, with the usual one-click update. No GitHub account or token needed on the
WordPress site; this repo is public and the plugin checks it a few times a day.

## Several properties on one WordPress site

Give each placement its own slug:

```
[boracay_booking slug="the-ronin" button_text="Book The Ronin"]
```

## Shortcode attributes

All optional; each overrides the matching setting for that placement.

| Attribute     | Default                            | Notes                                                        |
|---------------|------------------------------------|--------------------------------------------------------------|
| `slug`        | *(required, from settings)*        | Property slug on the platform                                |
| `max_guests`  | `8`                                | Ceiling on the picker; shrinks further to the largest room's actual capacity once it's known |
| `button_text` | `Check Availability`               |                                                              |
| `accent`      | `#1a1814`                          | Button and selected-day colour                               |
| `highlight`   | `#8b6a3e`                          | Icon, active date, promo code colour                         |
| `open_in`     | `same`                             | `same` or `new` tab                                          |
| `class`       |                                    | Extra CSS class on the wrapper                               |
| `lang`        | *(automatic)*                      | Force a language: `en`, `zh-TW`, `zh-CN`, `ko`, `ja`, `ru`. Normally detected from the page |
| `booking_url` | *(blank = automatic)*              | Force a different booking address                            |
| `min_nights`  | `0` (automatic)                    | Force a minimum stay instead of the property's own           |
| `api_url`     | `https://reservations.boracay.io`  | Platform that serves prices; only change if it ever moves    |

## How it talks to the platform

- On page load: `GET {api_url}/api/{slug}/rate-calendar?from=&to=` (public, CORS-open) returns
  nightly prices, the property's `min_nights` and its `booking_url`. One request per property
  per page, shared by every widget on it.
- Also on page load: `GET {api_url}/api/{slug}/rooms` (no dates) returns the property's room
  types so the guest picker can be capped at what the largest room actually sleeps, instead of
  always offering up to `max_guests`. One request per property per page, same sharing as above.
- If either call fails, the calendar simply shows no prices, the minimum stay is 1 night, the
  guest picker falls back to `max_guests`, and guests are sent to `{api_url}/{slug}`.
- On click: a plain link to `{booking url}?check_in=&check_out=&guests=&agent_code=`.
  Nothing is stored on the WordPress site.

`min_nights` and `booking_url` in the rate-calendar response, and the `/rooms` endpoint's
`max_guests` field, need the platform release that added them; on an older release the widget
uses the fallbacks above.

## Notes

- Upgrading from 1.0: the old `[sevenstones_booking]` shortcode still works, but settings
  were re-keyed, so open Settings → Boracay Booking once and enter the slug.
- Upgrading from 1.1: no action needed — the guest picker now narrows itself to what the
  property's rooms actually sleep automatically.
- Upgrading from 1.2.0 or earlier: those were installed by hand and don't know how to
  check GitHub for updates. Re-download and reinstall once from
  [Releases](https://github.com/techsupportboracay/boracay-booking-widget/releases/latest);
  every version after that updates itself.
- The calendar popover is positioned absolutely; if it is clipped, an ancestor
  section has `overflow: hidden` (in Elementor: Section → Layout → Overflow → Default).

## Languages

The widget speaks the booking platform's six languages (English, 繁體中文, 简体中文, 한국어, 日本語, Русский).
The language is taken from **Polylang** (or WPML), falling back to the site's WordPress locale. It translates the
widget's own text and date formats, and adds `&lang=xx` to the booking link so the booking page opens in the same
language. Custom `button_text` is left as written. Override with `[boracay_booking lang="ja"]` or the
`bkw_booking_lang` filter.

## Releasing a new version (maintainers)

1. Bump `Version:` and `BKW_BOOKING_VERSION` in `boracay-booking-widget.php` (they must match).
2. Rebuild `boracay-booking-widget.zip` from this folder so it's ready to attach.
3. `git commit`, `git push`, then `git tag vX.Y.Z && git push --tags`.
4. `gh release create vX.Y.Z boracay-booking-widget.zip --title vX.Y.Z --notes "..."` (or use the
   GitHub web UI: **Releases → Draft a new release**, pick the tag, attach the zip).

Plugin Update Checker prefers the zip attached to the release over the raw repo contents, so
every WordPress site running the plugin picks up exactly that build within a few hours (or
immediately if an admin clicks **Check again** on the Updates page).
