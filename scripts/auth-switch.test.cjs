const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual component handlers with Clerk isolated from production.
function portal(signIn, signUp = {}, initialMode = 'signin') {
  const state = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/components/ui/auth-switch.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useState: (value) => { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], (v) => { state[i] = v; }]; },
      useRef: (value) => { const i = cursor++; return state[i] ??= { current: value }; }, useEffect: () => {},
    };
    if (name === '@clerk/clerk-react') return {
      useSignIn: () => ({ isLoaded: true, signIn, setActive: async () => {} }),
      useSignUp: () => ({ isLoaded: true, signUp, setActive: async () => {} }),
    };
    return new Proxy({}, { get: (_, key) => key });
  }, window: { location: { search: '', pathname: '/', replace: () => {} } }, URLSearchParams });
  function render() { cursor = 0; return exports.AuthSwitch({ initialMode }); }
  function nodes(node, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(n => nodes(n, result)); return result; }
    result.push(node); nodes(node.props?.children, result); return result;
  }
  return {
    find: (predicate) => nodes(render()).find(predicate),
    submit: () => nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }),
    text: () => JSON.stringify(render()),
  };
}

for (const status of ['needs_second_factor', 'needs_client_trust']) {
  test(`${status}: prepares email with its ID and verifies the code`, async () => {
    const prepared = []; const verified = [];
    const signIn = { status, supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'email_123' }],
      create: async () => signIn, prepareSecondFactor: async p => prepared.push(p),
      attemptSecondFactor: async p => { verified.push(p); return { status: 'complete', createdSessionId: 'session_1' }; } };
    const ui = portal(signIn); await ui.submit();
    assert.deepEqual(JSON.parse(JSON.stringify(prepared)), [{ strategy: 'email_code', emailAddressId: 'email_123' }]);
    assert.match(ui.text(), /envoyé par email/);
    ui.find(n => n.props?.label === 'Code de confirmation').props.onChange('123 456');
    await ui.submit(); assert.equal(verified[0].code, '123456');
  });
}
test('TOTP asks for authenticator code without promising an email', async () => {
  const signIn = { supportedSecondFactors: [{ strategy: 'totp' }], create: async () => ({ ...signIn, status: 'needs_second_factor' }) };
  const ui = portal(signIn); await ui.submit(); assert.match(ui.text(), /application d'authentification/);
  assert.equal(ui.find(n => n.props?.children === 'Renvoyer le code'), undefined);
});
test('SMS preparation includes the phone ID', async () => {
  let prepared;
  const signIn = { status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'phone_code', phoneNumberId: 'phone_1' }], create: async () => signIn, prepareSecondFactor: async p => { prepared = p; } };
  const ui = portal(signIn); await ui.submit(); assert.equal(prepared.phoneNumberId, 'phone_1'); assert.match(ui.text(), /par SMS/);
});
test('failed email preparation keeps the login form and displays the error', async () => {
  const signIn = { status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'email_1' }], create: async () => signIn, prepareSecondFactor: async () => { throw { errors: [{ longMessage: 'Envoi indisponible' }] }; } };
  const ui = portal(signIn); await ui.submit(); assert.match(ui.text(), /Envoi indisponible/);
  assert.equal(ui.find(n => n.props?.label === 'Code de confirmation'), undefined);
});
test('signup prepares email verification and accepts the code', async () => {
  let sent = 0; let verified = false;
  const signUp = { status: 'missing_requirements', unverifiedFields: ['email_address'], create: async () => signUp,
    prepareEmailAddressVerification: async () => { sent++; },
    attemptEmailAddressVerification: async () => { verified = true; return { status: 'complete', createdSessionId: 'session_1' }; } };
  const ui = portal({}, signUp, 'signup');
  ui.find(n => n.props?.id === 'terms-acceptance').props.onChange({ target: { checked: true } });
  await ui.submit(); assert.equal(sent, 1); assert.ok(ui.find(n => n.props?.children === 'Renvoyer le code'));
  await ui.submit(); assert.equal(verified, true);
});
test('resend requests another email on the same second-factor attempt', async () => {
  let sent = 0;
  const signIn = { status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'email_1' }], create: async () => signIn, prepareSecondFactor: async () => { sent++; } };
  const ui = portal(signIn); await ui.submit();
  ui.find(n => n.props?.children === 'Renvoyer le code').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent, 2); assert.match(ui.text(), /Un nouveau code a été envoyé/);
});
test('password reset continues into second factor instead of reporting an invalid password', async () => {
  let sent = 0;
  const signIn = { status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'email_1' }], create: async () => signIn, attemptFirstFactor: async () => signIn, prepareSecondFactor: async () => { sent++; } };
  const ui = portal(signIn);
  ui.find(n => n.props?.children === 'Mot de passe oublié ?').props.onClick();
  ui.find(n => n.props?.label === 'Adresse email').props.onChange('test@example.com');
  await ui.submit(); await ui.submit();
  assert.equal(sent, 1); assert.match(ui.text(), /envoyé par email/);
  assert.doesNotMatch(ui.text(), /mot de passe est invalide/);
});
