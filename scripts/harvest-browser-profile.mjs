#!/usr/bin/env node
/**
 * 从真实浏览器采集 baxia 指纹（浏览器指纹），供代理复用。
 *
 * 背景：2026-10-22 起 /api/v2/chat/completions 同时要求
 *   - `Version` 请求头（等于线上前端版本），
 *   - 有效的 baxia `bx-ua` / `bx-umidtoken`，
 *   - 浏览器会话 cookie（tfstk / isg / atpsida / acw_tc / ssxmod_* / refresh_token）。
 * 这三样只能由真实浏览器产生（baxia 的 JS 在页面里生成），所以这里连上浏览器把当前
 * 会话的 cookie 和请求头「采」下来，写进 data/browser-profile.json，代理之后原样复用。
 *
 * 用法：
 *   1) 关掉所有 Chrome，然后带调试端口启动（用你平时登录 Qwen 的那个 profile）：
 *        "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 *          --remote-debugging-port=9333 --profile-directory=Default ^
 *          https://chat.qwen.ai/
 *   2) 确认页面已登录（能看到对话界面）。
 *   3) node scripts/harvest-browser-profile.mjs
 *   4) 代理会自动读取 data/browser-profile.json（按 mtime 热加载，不用重启）。
 *
 * 凭证会过期：completions 开始返回 unauthorized / Bad_Request 时重跑一次即可。
 * 也可以把它挂到定时任务里（每 10~20 分钟一次）。
 */

import { writeFile, mkdir } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { WebSocket } from 'undici'

// 注入 cookie 的域：必须是 **.qwen.ai**（域 cookie），不能是 host-only 的 chat.qwen.ai。
// 前端换 access token 打的是 https://auth.qwen.ai/api/v2/auths/refresh（withCredentials），
// 而 host-only cookie 不会发到 auth 子域 —— 服务端回 {"success":false,"code":"Unauthorized"}，
// 页面就永远拿不到 token（localStorage 里没有 token），采集脚本只能报「没有登录 Qwen」。
// 这是 2026-10-22 那次卡点的真正原因，别改回 chat.qwen.ai。
export const QWEN_COOKIE_DOMAIN = '.qwen.ai'

/** 把 `a=1; b=2` 形式的 Cookie 头拆成 CDP 需要的 { name, value } 列表。 */
export const cookiePairs = (cookieHeader) => String(cookieHeader || '')
    .split('; ')
    .map((pair) => {
        const index = pair.indexOf('=')
        return index > 0 ? { name: pair.slice(0, index), value: pair.slice(index + 1) } : null
    })
    .filter(Boolean)

// 页面里取「已登录」的 access token：应用把 access_token 写在 localStorage.token
const TOKEN_PROBE = `(() => {
    const token = localStorage.getItem('token');
    return typeof token === 'string' && token.length > 50 ? token : '';
})()`

/** 一条 cookie 的 Network.setCookie 参数：域 cookie + Secure + SameSite=None（跨子域同站）。 */
export const injectCookieParams = (cookie) => ({
    ...cookie,
    domain: QWEN_COOKIE_DOMAIN,
    path: '/',
    secure: true,
    sameSite: 'None',
})

/**
 * 在页面上下文里用账号邮箱/密码登录的表达式（同源 fetch + credentials）。
 *
 * 为什么在浏览器里登录而不是用 Node 直接打接口：登录成功后服务端下发的是
 * `refresh_token` **cookie**，只有浏览器会把它存进 cookie jar；之后页面自己用
 * `/auths/refresh` 换 access_token。顺带 baxia 会给这个请求自动挂上 `bx-ua`，
 * 比 Node 侧裸请求更不容易被 WAF 拦。
 *
 * 密码在这里做 sha256 十六进制，与 src/utils/tools.js#sha256Encrypt 保持一致。
 */
export const buildSigninExpression = (email, password) => `(async () => {
    const hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
        .map((b) => b.toString(16).padStart(2, '0')).join('')
    const response = await fetch('/api/v1/auths/signin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json', source: 'web' },
        body: JSON.stringify({ email: ${JSON.stringify(email)}, password: await hex(${JSON.stringify(password)}) })
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    const token = json && (json.token || (json.data && json.data.token))
    return { status: response.status, ok: Boolean(token), snippet: String(text).slice(0, 300) }
})()`

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name)
    return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const DEBUG_PORT = Number(argValue('--port', process.env.CHROME_DEBUG_PORT || 9333))
const DEBUG_HOST = process.env.CHROME_DEBUG_HOST || '127.0.0.1'
const OUT_FILE = path.resolve(argValue('--out', process.env.BROWSER_PROFILE_PATH || path.join('data', 'browser-profile.json')))
const TARGET_URL_PART = 'chat.qwen.ai'
// --login-account：服务端自备指纹（不需要用户本机 Chrome）。账号邮箱/密码从环境变量传，
// 不走 argv（进程列表里能看到 argv，别把密码放那儿）。
const LOGIN_ACCOUNT = (() => {
    if (!process.argv.includes('--login-account')) return null
    try {
        const parsed = JSON.parse(process.env.QWEN2API_LOGIN_ACCOUNT || '')
        return parsed && parsed.email && parsed.password ? parsed : null
    } catch {
        return null
    }
})()
// --headless：自己拉一个无头 Chrome（临时 profile），配合 --inject-from 把已有指纹的 cookie
// 注入进去，让页面自己用 refresh_token 换新 access token。这样不需要常挂浏览器窗口。
const HEADLESS = process.argv.includes('--headless') || LOGIN_ACCOUNT !== null
const INJECT_FROM = argValue('--inject-from', '')
const CHROME_PATH = argValue('--chrome', process.env.CHROME_PATH || '')

const log = (...args) => console.log('[harvest]', ...args)

const defaultChrome = () => {
    if (CHROME_PATH) return CHROME_PATH
    if (process.platform === 'win32') {
        const candidates = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ]
        for (const candidate of candidates) {
            try { if (fs.existsSync(candidate)) return candidate } catch { /* ignore */ }
        }
        return ''
    }
    if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
        try { if (fs.existsSync(candidate)) return candidate } catch { /* ignore */ }
    }
    return ''
}

const portOpen = async () => {
    try {
        const res = await fetch(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) })
        return res.ok
    } catch (_) {
        return false
    }
}

/** 起一个临时 profile 的无头 Chrome；返回进程句柄（调用方负责 kill）。 */
const launchHeadless = async () => {
    const { spawn } = await import('node:child_process')
    const { mkdtemp } = await import('node:fs/promises')
    const os = await import('node:os')
    const exe = defaultChrome()
    if (!exe) throw new Error('找不到 Chrome，可传 --chrome <路径> 或设置 CHROME_PATH')
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'qwen2api-headless-'))
    const child = spawn(exe, [
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank'
    ], { stdio: 'ignore', windowsHide: true })
    for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (await portOpen()) return child
        if (child.exitCode !== null) throw new Error(`headless Chrome 提前退出（code ${child.exitCode}）`)
    }
    child.kill()
    throw new Error('headless Chrome 30 秒内没有起来')
}

const cdpGet = async (pathname) => {
    const res = await fetch(`http://${DEBUG_HOST}:${DEBUG_PORT}${pathname}`)
    if (!res.ok) throw new Error(`CDP ${pathname} -> HTTP ${res.status}`)
    return res.json()
}

/** 新版 Chrome 的 /json/new 只接受 PUT（GET 返回 405）。 */
const cdpPut = async (pathname) => {
    const res = await fetch(`http://${DEBUG_HOST}:${DEBUG_PORT}${pathname}`, { method: 'PUT' })
    if (!res.ok) throw new Error(`CDP PUT ${pathname} -> HTTP ${res.status}`)
    return res.json()
}

/** 找到一个 chat.qwen.ai 的页面 target；没有就用 /json/new 开一个。 */
const findTarget = async () => {
    const targets = await cdpGet('/json/list')
    const page = targets.find((t) => t.type === 'page' && t.url.includes(TARGET_URL_PART))
    if (page) return page

    // headless + 注入/登录模式：cookie 必须先注入（或先登录）再导航，否则页面会先以
    // 未登录态启动一次（白等 8 秒，还可能把「已登出」状态写进 localStorage）。直接用现成的空白页。
    if (HEADLESS && (INJECT_FROM || LOGIN_ACCOUNT)) {
        const blank = targets.find((t) => t.type === 'page')
        if (blank) return blank
    }

    log('没有找到 chat.qwen.ai 页面，尝试新开一个…')
    // 新版 Chrome 的 /json/new 只接受 PUT（GET 返回 405）
    let created
    try {
        created = await cdpPut(`/json/new?${encodeURIComponent('https://chat.qwen.ai/')}`)
    } catch (error) {
        // 兜底：复用现有的第一个 page target，由调用方 Page.navigate 过去
        const targets = await cdpGet('/json/list')
        created = targets.find((t) => t.type === 'page')
        if (!created) throw error
    }
    // 等页面加载完再采集
    await new Promise((resolve) => setTimeout(resolve, 8000))
    return created
}

class Cdp {
    /**
     * @param {string} wsUrl 页面 target 的 webSocketDebuggerUrl
     * @param {{connectTimeoutMs?: number, commandTimeoutMs?: number}} [options]
     */
    constructor(wsUrl, { connectTimeoutMs = 15000, commandTimeoutMs = 20000 } = {}) {
        this.ws = new WebSocket(wsUrl)
        this.id = 0
        this.pending = new Map()
        this.handlers = new Map()
        this.closed = false
        this.commandTimeoutMs = commandTimeoutMs
        // 连接本身也要有超时：浏览器正在退出时 ws 可能既不 open 也不 error，
        // 没有超时就会永远挂住（实测过一次：脚本卡到被外部 kill）。
        this.ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('连接 CDP 超时（浏览器可能在退出）')), connectTimeoutMs)
            this.ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
            this.ws.addEventListener('error', (event) => {
                clearTimeout(timer)
                reject(new Error(`WebSocket 失败: ${event?.message || 'unknown'}`))
            })
        })
        this.ws.addEventListener('close', () => this.failAll(new Error('CDP 连接已关闭（浏览器退出了？）')))
        this.ws.addEventListener('message', (event) => {
            let msg
            try {
                msg = JSON.parse(String(event.data))
            } catch {
                return
            }
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id)
                this.pending.delete(msg.id)
                if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`))
                else resolve(msg.result)
                return
            }
            if (msg.method && this.handlers.has(msg.method)) {
                for (const handler of this.handlers.get(msg.method)) handler(msg.params)
            }
        })
    }

    /** 连接断开时把还在等的命令全部失败掉，否则它们会永远 pending。 */
    failAll(error) {
        this.closed = true
        for (const { reject } of this.pending.values()) reject(error)
        this.pending.clear()
    }

    send(method, params = {}) {
        if (this.closed) return Promise.reject(new Error(`CDP 已断开，无法执行 ${method}`))
        const id = ++this.id
        return new Promise((resolve, reject) => {
            // 每条命令也要有超时：页面导航/崩溃时响应可能永远不来
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`CDP ${method} 超时（${this.commandTimeoutMs}ms）`))
            }, this.commandTimeoutMs)
            this.pending.set(id, {
                resolve: (value) => { clearTimeout(timer); resolve(value) },
                reject: (error) => { clearTimeout(timer); reject(error) },
            })
            try {
                this.ws.send(JSON.stringify({ id, method, params }))
            } catch (error) {
                clearTimeout(timer)
                this.pending.delete(id)
                reject(error)
            }
        })
    }

    on(method, handler) {
        if (!this.handlers.has(method)) this.handlers.set(method, new Set())
        this.handlers.get(method).add(handler)
        return () => this.handlers.get(method).delete(handler)
    }

    close() {
        try { this.ws.close() } catch { /* ignore */ }
    }
}

const main = async () => {
    // --headless：端口没开就自己拉一个临时 profile 的无头 Chrome（采完就关）
    let chromeChild = null
    if (HEADLESS && !(await portOpen())) {
        log('启动临时 headless Chrome…')
        chromeChild = await launchHeadless()
    }
    try {
        const target = await findTarget()
        log(`已连接页面: ${target.url}`)

    const cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Network.enable')

    // 捕获任意一个受 baxia 保护的请求，从它身上拿到 bx-ua / bx-umidtoken / bx-v / Version
    let captured = null
    cdp.on('Network.requestWillBeSent', (params) => {
        const url = params?.request?.url || ''
        if (!url.includes(TARGET_URL_PART)) return
        const headers = params.request.headers || {}
        const bxUa = headers['bx-ua'] || headers['Bx-Ua']
        if (bxUa && !captured) captured = { headers, url }
    })

    const evaluate = async (expression) => {
        const result = await cdp.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
        })
        if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败')
        return result?.result?.value
    }

    // 先刷新一次页面：应用启动时会用 refresh_token 换新的 access token 并写回 localStorage。
    // 不刷新的话，页面空闲时 localStorage 里可能还是那个已经过期 15 分钟的 token。
    await cdp.send('Page.enable')

    // 页面启动后会自己用 refresh_token 换 access_token 写进 localStorage：轮询等它出现，
    // 别用固定 sleep（网络快时白等，网络慢时又不够）。导航过程中执行上下文会被销毁，等下一轮。
    const waitForStoredToken = async (maxTries = 40) => {
        for (let i = 0; i < maxTries; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            try {
                const token = await evaluate(TOKEN_PROBE)
                if (token) return token
            } catch { /* 导航中，继续等 */ }
        }
        return ''
    }

    if (INJECT_FROM) {
        // 无头 + 注入 cookie：把已有指纹的会话搬进临时 profile，页面启动时自己用
        // refresh_token 换新 token，再照常采集。这样不需要一直挂着浏览器窗口。
        //
        // 关键：cookie 必须注入到 **.qwen.ai**（域 cookie），见 QWEN_COOKIE_DOMAIN 的注释。
        const { readFileSync } = await import('node:fs')
        const injected = JSON.parse(readFileSync(path.resolve(INJECT_FROM), 'utf8'))
        const pairs = cookiePairs(injected.cookie)
        let injectedCount = 0
        for (const cookie of pairs) {
            try {
                const result = await cdp.send('Network.setCookie', injectCookieParams(cookie))
                if (result && result.success) injectedCount++
            } catch { /* 个别 cookie 不合规（值里有分号等）就跳过，不影响 refresh_token */ }
        }
        log(`已注入 ${injectedCount}/${pairs.length} 条 cookie（domain=${QWEN_COOKIE_DOMAIN}），打开会话页…`)
        await cdp.send('Page.navigate', { url: 'https://chat.qwen.ai/' })
        if (await waitForStoredToken()) log('页面已用 refresh_token 换到新 access_token')
        else log('警告：页面 20 秒内没有拿到 token（refresh_token 可能已失效）')
    } else if (LOGIN_ACCOUNT) {
        // 服务端自备指纹：在无头浏览器里用账号邮箱密码登录。服务端下发 refresh_token cookie，
        // 再重新加载让应用自己换 access_token。用户不需要本机 Chrome，也不需要跑命令行。
        await cdp.send('Page.navigate', { url: 'https://chat.qwen.ai/' })
        // 等页面加载完（baxia 初始化）：登录请求由页面发出，带上 bx-ua 才不容易被 WAF 拦
        for (let i = 0; i < 30; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            try {
                if (await evaluate(`document.readyState === 'complete'`)) break
            } catch { /* 导航中，继续等 */ }
        }
        const signin = await evaluate(buildSigninExpression(LOGIN_ACCOUNT.email, LOGIN_ACCOUNT.password))
        if (!signin || !signin.ok) {
            const detail = signin && signin.snippet ? `：${String(signin.snippet).replace(/\s+/g, ' ').slice(0, 160)}` : ''
            throw new Error(`账号登录失败（HTTP ${signin ? signin.status : '?'}）${detail}。请确认密码正确、账号没有被风控/验证码拦住`)
        }
        log(`已用账号密码登录（HTTP ${signin.status}），等页面换 token…`)
        await cdp.send('Page.navigate', { url: 'https://chat.qwen.ai/' })
        if (await waitForStoredToken()) log('页面已换到新的 access_token')
        else log('警告：登录成功但页面 20 秒内没有拿到 token')
    } else {
        await cdp.send('Page.reload', { ignoreCache: false })
        await new Promise((resolve) => setTimeout(resolve, 6000))
    }

    // 先确认登录态（有 token 才说明这个 profile 已登录），顺便把它取出来：
    // 浏览器当前的 access token 才是有效的那一个（账号里存的是上次登录时的，可能已被
    // 新会话挤掉/过期），代理优先用它做 Authorization。
    const storedToken = await evaluate(TOKEN_PROBE)
    if (!storedToken) {
        if (LOGIN_ACCOUNT) {
            throw new Error('登录接口返回成功，但页面没有换到 token（可能是账号被风控/需要验证码）。')
        }
        throw new Error(INJECT_FROM
            ? '注入 cookie 后页面没能换到 token（refresh_token 可能已过期/被登出，或 cookie 没注入到 .qwen.ai 域）。请重开一次真实浏览器窗口登录 chat.qwen.ai 再采一次。'
            : '这个浏览器 profile 没有登录 Qwen（localStorage 里没有 token）。请先在该 Chrome 窗口登录 chat.qwen.ai。')
    }
    log('登录态正常，开始采集 baxia 指纹…')

    // 打一个受 baxia 保护（在它的 checkApiPath 名单里）的只读接口，让 baxia 在请求上挂指纹头。
    // 注意：/api/v2/models 不在名单里，baxia 不会给它加 bx-ua；/api/v2/chats 在。
    await evaluate(`fetch('/api/v2/chats?page=1', { headers: { accept: 'application/json', source: 'web' } }).then(r => r.text()).then(t => t.length)`)

    for (let i = 0; i < 30 && !captured; i++) await new Promise((resolve) => setTimeout(resolve, 200))
    if (!captured) {
        // 再试一个一定在名单里的写接口（不会真的产生数据：空 chatId 的 chats/new 会建一个空会话）
        await evaluate(`fetch('/api/v2/chats/new', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', source: 'web' }, body: JSON.stringify({ chatId: '', models: ['qwen3.8-max'], project_id: '', timestamp: Date.now(), chat_type: 't2t', chat_mode: 'normal' }) }).then(r => r.text()).then(t => t.length)`).catch(() => {})
        for (let i = 0; i < 30 && !captured; i++) await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!captured) throw new Error('没能捕获到带 bx-ua 的请求，请确认页面里 baxia 已初始化（刷新一次页面再试）')

    const headers = captured.headers
    const { cookies } = await cdp.send('Network.getAllCookies')
    const cookieHeader = (cookies || [])
        .filter((cookie) => String(cookie.domain || '').includes('qwen.ai'))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ')

    // 浏览器当前的 access token 才是有效的那一个：账号里存的是上次登录时的，可能已被
    // 新会话挤掉/过期。优先用捕获请求里的 Authorization，没有就用 localStorage 里的。
    const authorization = headers['Authorization'] || headers['authorization'] || ''
    const token = authorization.replace(/^Bearer\s+/i, '').trim() || storedToken

    // 浏览器真实的请求头：代理会原样复用，避免"合成的 Chrome 149 UA + 真实 155 指纹"自相矛盾
    const pick = (...names) => {
        for (const name of names) {
            if (headers[name]) return headers[name]
        }
        return ''
    }

    // 记下这个浏览器用的是哪个 profile 目录：代理可以在浏览器被关掉后自己用 headless 拉起来续期。
    // 显式传入最可靠（CDP 的 Browser.getBrowserCommandLine 在页面会话上拿不到，浏览器会话
    // 在部分版本上会挂住，所以不冒险去连）。
    let userDataDir = argValue('--user-data-dir', process.env.CHROME_USER_DATA_DIR || '')
    if (!userDataDir && !HEADLESS) {
        log('提示：没有提供 --user-data-dir，代理将无法在浏览器关闭后自动拉起 headless 续期')
    }

    const profile = {
        cookie: cookieHeader,
        token,
        bxUa: pick('bx-ua', 'Bx-Ua'),
        bxUmidtoken: pick('bx-umidtoken', 'Bx-Umidtoken'),
        bxV: pick('bx-v', 'Bx-V') || '2.5.37',
        version: pick('Version', 'version') || '0.3.20',
        userAgent: pick('User-Agent', 'user-agent'),
        secChUa: pick('sec-ch-ua', 'Sec-Ch-Ua'),
        secChUaPlatform: pick('sec-ch-ua-platform', 'Sec-Ch-Ua-Platform'),
        secChUaMobile: pick('sec-ch-ua-mobile', 'Sec-Ch-Ua-Mobile'),
        acceptLanguage: pick('Accept-Language', 'accept-language'),
        timezone: pick('Timezone', 'timezone'),
        // 记住端口与 profile 目录：代理自动续期时连回同一个浏览器；浏览器没开时可以自己拉起来。
        // headless 模式用的是临时 profile（采完即删），所以不记目录——下次继续走 --headless --inject-from。
        port: DEBUG_PORT,
        userDataDir: HEADLESS ? '' : userDataDir,
        harvestedAt: new Date().toISOString(),
        sourceUrl: captured.url,
    }

    if (!profile.cookie || !profile.bxUa) throw new Error('采集结果不完整（cookie 或 bx-ua 为空）')

    await mkdir(path.dirname(OUT_FILE), { recursive: true })
    await writeFile(OUT_FILE, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')

    log(`已写入 ${OUT_FILE}`)
    log(`  cookie: ${profile.cookie.length} 字符（${(cookies || []).filter((c) => String(c.domain || '').includes('qwen.ai')).length} 条）`)
    log(`  bx-ua: ${profile.bxUa.length} 字符`)
    log(`  Version: ${profile.version}`)
        cdp.close()
    } finally {
        // headless 模式：采完就把临时浏览器关掉，不留后台进程
        if (chromeChild) {
            try { chromeChild.kill() } catch { /* ignore */ }
        }
    }
}

// 只有被当成脚本直接跑时才执行采集；被测试 import 时（拿 QWEN_COOKIE_DOMAIN /
// cookiePairs / injectCookieParams 做断言）不能启动 Chrome。
// 注意：这个判断错了的后果很隐蔽——被判成「不是入口」时脚本什么都不做就 exit 0，
// 代理会以为采集成功，然后重新读那份没变过的指纹文件。所以 Windows 上按大小写
// 不敏感比较（路径大小写/短名可能和 argv 不一致）。
const isEntryPoint = () => {
    const entry = process.argv[1]
    if (!entry) return false
    try {
        const target = pathToFileURL(path.resolve(entry)).href
        return process.platform === 'win32'
            ? target.toLowerCase() === import.meta.url.toLowerCase()
            : target === import.meta.url
    } catch {
        return false
    }
}

if (isEntryPoint()) {
    main().catch((error) => {
        console.error('[harvest] 失败:', error.message)
        process.exit(1)
    })

    // 可选：常驻模式，每 N 分钟重新采集一次（凭证会过期，尤其是 access token）。
    //   node scripts/harvest-browser-profile.mjs --every 10
    const everyIndex = process.argv.indexOf('--every')
    if (everyIndex > 0) {
        const minutes = Number(process.argv[everyIndex + 1])
        if (Number.isFinite(minutes) && minutes > 0) {
            setInterval(() => {
                main().catch((error) => console.error('[harvest] 定时采集失败:', error.message))
            }, minutes * 60 * 1000)
            console.log(`[harvest] 已开启定时采集：每 ${minutes} 分钟一次（Ctrl+C 退出）`)
        }
    }
}

