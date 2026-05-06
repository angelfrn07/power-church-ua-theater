/**
 * Power Church UA Theater — Lightweight zero-account analytics
 *
 * Stack:
 *   1. Abacus (https://abacus.jasoncameron.dev) — anonymous hit counter, no signup, no auth
 *   2. URL ?v= tag captured per recipient (e.g. ?v=raul-aaf, ?v=tracy-bivins, ?v=deeter)
 *   3. Device-class detection (mobile / tablet / desktop)
 *   4. Time-on-page dwell beacons at 30s / 1m / 2m / 5m
 *   5. PDF click capture using sendBeacon-style image pixels (survives navigation)
 *   6. Session-dedupe via localStorage (30-minute window — same person reloading doesn't double-count)
 *   7. GA4 placeholder — paste a Measurement ID into GA_MEASUREMENT_ID below to light up
 *
 * Privacy: this script does NOT store IP addresses, cookies, fingerprints, or any
 * personally identifying information. Abacus only records hit counts. The ?v= tag
 * is an opt-in label set by the link sender, not the visitor.
 */

(function () {
  'use strict';

  // ---- Configuration ------------------------------------------------------

  const NAMESPACE = 'power-church-2026';
  const ABACUS_BASE = 'https://abacus.jasoncameron.dev';
  const SESSION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  const SESSION_KEY = 'pc_session_until';

  // OPTIONAL — paste a Google Analytics 4 Measurement ID here to also send to GA4.
  // Format: 'G-XXXXXXXXXX' — leave as empty string to disable GA4.
  const GA_MEASUREMENT_ID = '';

  // ---- Helpers ------------------------------------------------------------

  function pingHit(key) {
    try {
      // Image-pixel pattern survives page navigation (PDF downloads, link clicks).
      const url = `${ABACUS_BASE}/hit/${encodeURIComponent(NAMESPACE)}/${encodeURIComponent(key)}?ts=${Date.now()}`;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    } catch (_) {
      /* silently fail — never break the page */
    }
  }

  function getDeviceClass() {
    const ua = navigator.userAgent || '';
    if (/iPad|tablet|Tablet/i.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function getPageKey() {
    const path = (window.location.pathname || '/').toLowerCase();
    if (path.endsWith('/') || path.endsWith('index.html')) return 'page-home';
    if (path.includes('scenario-modeler')) return 'page-modeler';
    if (path.includes('stats')) return 'page-stats';
    if (path.includes('track')) return 'page-track';
    // fallback — slugify the last path segment
    const seg = path.split('/').filter(Boolean).pop() || 'unknown';
    return 'page-' + seg.replace(/\.html?$/, '').replace(/[^a-z0-9-]/g, '-');
  }

  function getQueryParam(name) {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(name);
    } catch (_) { return null; }
  }

  function isNewSession() {
    try {
      const until = parseInt(localStorage.getItem(SESSION_KEY) || '0', 10);
      const now = Date.now();
      if (now > until) {
        localStorage.setItem(SESSION_KEY, String(now + SESSION_WINDOW_MS));
        return true;
      }
      // refresh the rolling window
      localStorage.setItem(SESSION_KEY, String(now + SESSION_WINDOW_MS));
      return false;
    } catch (_) {
      // localStorage unavailable (private mode, etc.) — count every load as new
      return true;
    }
  }

  function pingGA4(eventName, params) {
    if (!GA_MEASUREMENT_ID || !window.gtag) return;
    try { window.gtag('event', eventName, params || {}); } catch (_) {}
  }

  // ---- Bootstrap ----------------------------------------------------------

  // Inject GA4 only if a measurement ID has been pasted in
  if (GA_MEASUREMENT_ID) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: true });
  }

  const newSession = isNewSession();
  const pageKey = getPageKey();
  const deviceClass = getDeviceClass();
  const tag = (getQueryParam('v') || '').toLowerCase().replace(/[^a-z0-9-_]/g, '');

  if (newSession) {
    // Total unique-ish visits (deduped per 30-minute window per device)
    pingHit('total-sessions');
    pingHit(pageKey);
    pingHit('device-' + deviceClass);

    if (tag) {
      pingHit('tag-' + tag);
      pingGA4('tagged_visit', { tag: tag, page: pageKey });
    } else {
      pingHit('tag-anonymous');
    }

    // UTM source / medium / campaign passthrough
    const utmSource = (getQueryParam('utm_source') || '').toLowerCase().replace(/[^a-z0-9-_]/g, '');
    const utmMedium = (getQueryParam('utm_medium') || '').toLowerCase().replace(/[^a-z0-9-_]/g, '');
    const utmCampaign = (getQueryParam('utm_campaign') || '').toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (utmSource) pingHit('utm-source-' + utmSource);
    if (utmMedium) pingHit('utm-medium-' + utmMedium);
    if (utmCampaign) pingHit('utm-campaign-' + utmCampaign);
  } else {
    // Page-reloads within the same session still get tracked but bucketed separately
    pingHit(pageKey + '-reload');
  }

  // Time-on-page dwell beacons — tells us roughly how long visitors stay
  // (we only fire dwell beacons on the FIRST hit of a session per page)
  if (newSession) {
    setTimeout(function () { pingHit('dwell-30s'); pingHit(pageKey + '-dwell-30s'); }, 30 * 1000);
    setTimeout(function () { pingHit('dwell-60s'); pingHit(pageKey + '-dwell-60s'); }, 60 * 1000);
    setTimeout(function () { pingHit('dwell-2min'); pingHit(pageKey + '-dwell-2min'); }, 120 * 1000);
    setTimeout(function () { pingHit('dwell-5min'); pingHit(pageKey + '-dwell-5min'); }, 300 * 1000);
  }

  // PDF download tracking — wire after DOM is ready
  function wirePdfTracking() {
    const links = document.querySelectorAll('a[href$=".pdf"]');
    links.forEach(function (a) {
      a.addEventListener('click', function () {
        const href = a.getAttribute('href') || '';
        const slug = href.split('/').pop().replace(/\.pdf$/i, '').toLowerCase().replace(/[^a-z0-9-_]/g, '-');
        pingHit('pdf-' + slug);
        if (tag) pingHit('pdf-' + slug + '-tag-' + tag);
        pingGA4('pdf_click', { pdf: slug, tag: tag || 'anonymous' });
      }, { capture: true, passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wirePdfTracking);
  } else {
    wirePdfTracking();
  }

  // Expose minimal API for the stats page
  window.__pcAnalytics = {
    NAMESPACE: NAMESPACE,
    ABACUS_BASE: ABACUS_BASE,
    pingHit: pingHit,
    getCount: function (key) {
      return fetch(`${ABACUS_BASE}/get/${encodeURIComponent(NAMESPACE)}/${encodeURIComponent(key)}`)
        .then(function (r) { return r.json(); })
        .then(function (j) { return (j && typeof j.value === 'number') ? j.value : 0; })
        .catch(function () { return 0; });
    }
  };
})();
