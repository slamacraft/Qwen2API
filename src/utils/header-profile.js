/**
 * Central browser header profile derived from per-account fingerprint.
 * Replaces 6+ duplicated hardcoded header blocks across the codebase.
 * Gated by config.antidetectTier1Enabled for instant rollback.
 */

const config = require('../config/index.js')
const { getTimezoneHeader } = require('./tools')
const { getBrowserProfile, getWebVersion } = require('./browser-profile')

// 关于 `Version` 请求头：**必须有**，且要等于线上前端版本。
// 2026-10-22 实测：缺这个头时 /api/v2/chat/completions 直接回 Bad_Request
// （"Internal error..."）；浏览器自己发的就是 `Version: 0.3.20`。
// 但只有这个头还不够——同一个请求还必须带有效的 baxia 指纹（bx-ua / bx-umidtoken）
// 和浏览器会话 cookie，否则 WAF 回 unauthorized。见 browser-profile.js。

/**
 * 浏览器指纹（baxia）覆盖：有指纹时用它替换合成的 cookie / UA / sec-ch-ua，并补上
 * baxia 头与浏览器当前的 access token。没有指纹时保持原行为（token + 合成的 ssxmod）。
 *
 * 按账号取：轮换到哪个账号就用哪个账号的会话（见 browser-profile.js 的文件命名）。
 * @param {object} headers
 * @param {object|null} account
 * @param {object} options
 */
const applyBrowserProfile = (headers, account, options) => {
    const profile = options.browserProfile === undefined
        ? getBrowserProfile(account && account.email)
        : options.browserProfile
    if (!profile) return

    headers['cookie'] = profile.cookie
    headers['bx-ua'] = profile.bxUa
    headers['bx-umidtoken'] = profile.bxUmidtoken
    headers['bx-v'] = profile.bxV
    // 浏览器真实请求头优先：代理合成的 UA 是 Chrome 149，浏览器是 155，两套并存等于自相矛盾
    if (profile.userAgent) headers['user-agent'] = profile.userAgent
    if (profile.secChUa) headers['sec-ch-ua'] = profile.secChUa
    if (profile.secChUaPlatform) headers['sec-ch-ua-platform'] = profile.secChUaPlatform
    if (profile.secChUaMobile) headers['sec-ch-ua-mobile'] = profile.secChUaMobile
    if (profile.acceptLanguage) headers['accept-language'] = profile.acceptLanguage
    if (profile.timezone) headers['timezone'] = profile.timezone
    // 浏览器当前的 access token 优先：账号里存的那份可能已被新登录会话挤掉
    if (profile.token) headers['Authorization'] = `Bearer ${profile.token}`
}

/** `Version` 头：指纹文件里的前端版本 > QWEN_WEB_VERSION > 内置默认值。 */
const applyVersionHeader = (headers, account, options) => {
    headers['Version'] = (options && options.webVersion) || getWebVersion(account && account.email)
}

// Chrome version pool — small set to avoid identical UA across all accounts
const CHROME_VERSIONS = ['149.0.0.0', '148.0.0.0', '147.0.0.0', '146.0.0.0']

/**
 * Derive a stable Chrome major version from fingerprint hash.
 * @param {Object} fingerprint
 * @returns {string}
 */
function pickChromeVersion(fingerprint) {
    if (!fingerprint || !fingerprint.hash) return CHROME_VERSIONS[0]
    const idx = parseInt(fingerprint.hash.slice(30, 32), 16) % CHROME_VERSIONS.length
    return CHROME_VERSIONS[idx]
}

/**
 * Map fingerprint platform to Sec-CH-UA-Platform value.
 * @param {string} platform - e.g. 'MacIntel', 'Win32', 'Linux x86_64'
 * @returns {string}
 */
function platformToSecChUa(platform) {
    if (platform === 'MacIntel') return '"macOS"'
    if (platform === 'Win32') return '"Windows"'
    if (platform && platform.startsWith('Linux')) return '"Linux"'
    return '"Windows"'
}

/**
 * Build User-Agent string consistent with fingerprint platform.
 * @param {Object} fingerprint
 * @returns {string}
 */
function buildUserAgent(fingerprint) {
    const ver = pickChromeVersion(fingerprint)
    const platform = fingerprint && fingerprint.platform
    if (platform === 'MacIntel') {
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`
    }
    if (platform && platform.startsWith('Linux')) {
        return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`
    }
    // Default Windows
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`
}

/**
 * Build Sec-CH-UA header value.
 * @param {Object} fingerprint
 * @returns {string}
 */
function buildSecChUa(fingerprint) {
    const ver = pickChromeVersion(fingerprint)
    const major = ver.split('.')[0]
    return `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not)A;Brand";v="24"`
}

/**
 * Legacy static headers used when ANTIDETECT_TIER1_ENABLED=false.
 * Matches pre-change hardcoded values exactly.
 */
const LEGACY_HEADERS = {
    'sec-ch-ua-platform': '"Windows"',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
}

const LEGACY_UA = LEGACY_HEADERS['user-agent']

/**
 * Build full request headers for an upstream Qwen API call.
 * @param {Object} account - Account object (must have .fingerprint after ensureAccountFingerprint)
 * @param {Object} options - Additional header overrides or context
 * @param {string} [options.chatBaseUrl] - Base URL for referer/host/origin
 * @param {string} [options.token] - JWT token for cookie assembly
 * @param {string} [options.ssxmodItna] - Per-account ssxmod_itna value
 * @param {string} [options.ssxmodItna2] - Per-account ssxmod_itna2 value
 * @param {string} [options.accept] - Accept header value
 * @param {string} [options.refererPath] - Referer path suffix (default '/')
 * @param {boolean} [options.stream] - Whether this is a streaming request
 * @param {Object} [options.extra] - Additional headers to merge
 * @returns {Object} Complete headers object
 */
function buildRequestHeaders(account, options = {}) {
    // Feature flag gate: revert to legacy static headers
    if (!config.antidetectTier1Enabled) {
        const headers = {
            ...LEGACY_HEADERS,
            'content-type': 'application/json',
            'accept': options.accept || 'application/json',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'source': 'web',
            'timezone': getTimezoneHeader(),
            'connection': 'keep-alive',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin'
        }
        if (options.chatBaseUrl) {
            headers['referer'] = `${options.chatBaseUrl}${options.refererPath || '/'}`
            headers['host'] = options.chatBaseUrl.replace(/^https?:\/\//, '')
            headers['origin'] = options.chatBaseUrl
        }
        if (options.token) {
            const cookieParts = [`token=${options.token}`]
            if (options.ssxmodItna) cookieParts.push(`ssxmod_itna=${options.ssxmodItna}`)
            if (options.ssxmodItna2) cookieParts.push(`ssxmod_itna2=${options.ssxmodItna2}`)
            headers['cookie'] = cookieParts.join(';')
            // FE 0.3.x 起 completions 硬校验 Bearer 鉴权（缺失则 Unauthorized），与前端 eX 拦截器一致
            headers['Authorization'] = `Bearer ${options.token}`
        }
        if (options.extra) Object.assign(headers, options.extra)
        applyBrowserProfile(headers, account, options)
        applyVersionHeader(headers, account, options)
        return headers
    }

    const fp = account && account.fingerprint
    const ua = fp ? buildUserAgent(fp) : LEGACY_UA
    const secChUa = fp ? buildSecChUa(fp) : LEGACY_HEADERS['sec-ch-ua']
    const secChPlatform = fp ? platformToSecChUa(fp.platform) : LEGACY_HEADERS['sec-ch-ua-platform']
    const language = fp ? fp.language || 'zh-CN' : 'zh-CN'

    // Derive timezone from fingerprint offset; fall back to server TZ only when missing or invalid
    const rawTz = fp && fp.timezoneOffset != null ? Number(fp.timezoneOffset) : NaN
    const tzOffset = Number.isFinite(rawTz) ? Math.trunc(rawTz) : null
    const timezone = tzOffset !== null
        ? `UTC${tzOffset <= 0 ? '+' : '-'}${String(Math.abs(tzOffset) / 60).padStart(2, '0')}`
        : getTimezoneHeader()

    const headers = {
        'sec-ch-ua-platform': secChPlatform,
        'accept-language': language.includes('-') ? `${language},${language.split('-')[0]};q=0.9` : language,
        'sec-ch-ua': secChUa,
        'sec-ch-ua-mobile': '?0',
        'user-agent': ua,
        'content-type': 'application/json',
        'accept': options.accept || 'application/json',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'source': 'web',
        'timezone': timezone,
        'connection': 'keep-alive',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin'
    }

    if (options.chatBaseUrl) {
        headers['referer'] = `${options.chatBaseUrl}${options.refererPath || '/'}`
        headers['host'] = options.chatBaseUrl.replace(/^https?:\/\//, '')
        headers['origin'] = options.chatBaseUrl
    }

    if (options.token) {
        const cookieParts = [`token=${options.token}`]
        if (options.ssxmodItna) cookieParts.push(`ssxmod_itna=${options.ssxmodItna}`)
        if (options.ssxmodItna2) cookieParts.push(`ssxmod_itna2=${options.ssxmodItna2}`)
        headers['cookie'] = cookieParts.join(';')
        // FE 0.3.x 起 completions 硬校验 Bearer 鉴权（缺失则 Unauthorized），与前端 eX 拦截器一致
        headers['Authorization'] = `Bearer ${options.token}`
    }

    if (options.extra) Object.assign(headers, options.extra)

    // 指纹与 Version 最后覆盖：它们代表"真实浏览器"，必须赢过上面合成的 UA/cookie
    applyBrowserProfile(headers, account, options)
    applyVersionHeader(headers, account, options)

    return headers
}

module.exports = {
    buildRequestHeaders,
    buildUserAgent,
    buildSecChUa,
    platformToSecChUa,
    pickChromeVersion,
    LEGACY_HEADERS,
    LEGACY_UA
}
