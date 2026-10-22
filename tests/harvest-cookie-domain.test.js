// Por que existe este fichero.
//
// El 2026-10-22 la renovacion headless de credenciales fallaba de forma MUDA: el Chrome
// temporal arrancaba, las 19 cookies se inyectaban sin error, la pagina abria... y el login
// no se reconocia. `localStorage` nunca tenia `token`, el script concluia "este profile no
// ha iniciado sesion" y el proxy gastaba su unico intento de renovacion. Nada en la salida
// apuntaba a la causa.
//
// La causa era el DOMINIO de las cookies: se inyectaban host-only en chat.qwen.ai, pero el
// refresco del front va a https://auth.qwen.ai/api/v2/auths/refresh (withCredentials: true).
// Una cookie host-only de chat.qwen.ai no viaja al subdominio auth, el servidor contesta
// {"success":false,"data":{"code":"Unauthorized"}} y el token no aparece nunca. Inyectadas
// como cookie de dominio (.qwen.ai) el refresco devuelve 200, el access_token aterriza en
// localStorage y la recoleccion funciona.
//
// Este contrato no se puede probar abriendo un navegador en CI, asi que se prueba donde si
// es determinista: importando el script (el entrypoint no se ejecuta al importar) y mirando
// exactamente lo que se le pasa a Network.setCookie. Si alguien vuelve a poner
// chat.qwen.ai, esta prueba falla en vez de dejar un sintoma mudo de 15 minutos.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCRIPT = path.join(__dirname, '../scripts/harvest-browser-profile.mjs');
// En Windows una ruta absoluta no sirve como especificador ESM: hace falta file://.
const load = () => import(pathToFileURL(SCRIPT).href);

describe('harvest-browser-profile: las cookies se inyectan como cookie de dominio .qwen.ai', () => {
  it('el dominio de inyeccion es .qwen.ai (el refresco vive en auth.qwen.ai)', async () => {
    const { QWEN_COOKIE_DOMAIN, injectCookieParams } = await load();
    assert.equal(QWEN_COOKIE_DOMAIN, '.qwen.ai',
      'el refresco del front es GET https://auth.qwen.ai/api/v2/auths/refresh: con una cookie ' +
      'host-only de chat.qwen.ai el servidor responde Unauthorized y no hay token');

    const params = injectCookieParams({ name: 'refresh_token', value: 'r' });
    assert.equal(params.domain, '.qwen.ai');
    assert.equal(params.path, '/');
  });

  it('la cookie inyectada viaja al subdominio auth (Secure + SameSite=None)', async () => {
    const { injectCookieParams } = await load();
    const params = injectCookieParams({ name: 'refresh_token', value: 'r' });
    // SameSite=Strict/Lax por defecto o secure:false pueden dejar la cookie fuera de la
    // peticion al subdominio; None+Secure es la forma que el navegador acepta y envia.
    assert.equal(params.secure, true);
    assert.equal(params.sameSite, 'None');
    assert.equal(params.name, 'refresh_token');
    assert.equal(params.value, 'r', 'el valor no se toca: es el refresh_token real');
  });

  it('cookiePairs parte el header Cookie sin perder valores con = dentro', async () => {
    const { cookiePairs } = await load();
    assert.deepEqual(cookiePairs('tfstk=a; refresh_token=x=y; isg=z'), [
      { name: 'tfstk', value: 'a' },
      { name: 'refresh_token', value: 'x=y' },
      { name: 'isg', value: 'z' }
    ]);
    // Entradas sin `=` (basura de un header mal formado) se descartan en vez de romper.
    assert.deepEqual(cookiePairs('solo-basura; a=1'), [{ name: 'a', value: '1' }]);
    assert.deepEqual(cookiePairs(''), []);
    assert.deepEqual(cookiePairs(undefined), []);
  });

  it('el script no vuelve a inyectar en el dominio host-only', () => {
    // Red de seguridad sobre el fuente: el bug original era un literal, y un literal es lo
    // que se puede colar en un refactor sin que ninguna prueba de comportamiento lo note.
    const source = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(!/domain:\s*'chat\.qwen\.ai'/.test(source),
      'el script volvio a inyectar cookies host-only en chat.qwen.ai: el refresco de auth.qwen.ai no las recibe');
    assert.ok(/QWEN_COOKIE_DOMAIN\s*=\s*'\.qwen\.ai'/.test(source),
      'QWEN_COOKIE_DOMAIN tiene que seguir siendo .qwen.ai');
  });
});

describe('harvest-browser-profile: el servidor se fabrica la sesion (modo --login-account)', () => {
  // El servidor no tiene el Chrome del usuario, pero si tiene email+password de la cuenta.
  // En lugar de mandar al usuario a una terminal, el script abre un Chrome headless y hace
  // el login DENTRO de la pagina: el servidor responde con la cookie refresh_token, la pagina
  // la cambia por un access_token y despues se recolecta cookie + bx-ua como siempre.
  it('el login se hace en la pagina, con credenciales y sha256 (igual que token-manager)', async () => {
    const { buildSigninExpression } = await load();
    const expression = buildSigninExpression('a@b.com', 'secreto');

    // Mismo endpoint que usa src/utils/token-manager.js (login de Node)
    assert.match(expression, /\/api\/v1\/auths\/signin/);
    // credentials:'include' es lo que hace que la cookie refresh_token se guarde en el jar
    assert.match(expression, /credentials: 'include'/);
    // El servidor espera el sha256 en hexadecimal (src/utils/tools.js#sha256Encrypt)
    assert.match(expression, /SHA-256/);
    assert.match(expression, /toString\(16\)/);
    assert.match(expression, /"a@b\.com"/);
    assert.match(expression, /"secreto"/);
  });

  it('el resultado solo se considera bueno si el servidor devolvio token', async () => {
    const { buildSigninExpression } = await load();
    const expression = buildSigninExpression('a@b.com', 'x');
    // La expresion devuelve { status, ok, snippet }: ok exige token en la respuesta, y el
    // snippet deja que el proxy muestre el motivo real (email not found, captcha, ...).
    assert.match(expression, /ok: Boolean\(token\)/);
    assert.match(expression, /snippet/);
  });
});
