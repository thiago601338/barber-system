const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const os = require('node:os')
const path = require('node:path')
const {execFileSync} = require('node:child_process')

const project = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-blog-ui-'))
execFileSync(process.execPath, [path.join(project, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noCheck', '--module', 'commonjs', '--jsx', 'react-jsx', '--target', 'es2022', '--rootDir', 'src', '--outDir', temporary, 'src/MasterBlogPanel.tsx'], {cwd: project, stdio: 'pipe'})
process.on('exit', () => {
  const resolved = path.resolve(temporary)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('barber-blog-ui-')) throw Error('Unsafe temporary directory')
  fs.rmSync(resolved, {recursive: true, force: true})
})

function harness(api, initialPosts = [], initialAudit = [], read = null) {
  const slots = [], cache = {}, calls = [], reads = [], notifications = [], savedPosts = new Map()
  let index = 0, effects = [], tree
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    useState(initial) {
      const n = index++
      if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial
      return [slots[n], value => { slots[n] = typeof value === 'function' ? value(slots[n]) : value }]
    },
    useRef(value) { return react.useState(() => ({current: value}))[0] },
    useEffect(fn, deps) {
      const n = index++, before = slots[n]
      if (!before || !same(before.deps, deps)) effects.push(() => { before?.cleanup?.(); slots[n] = {deps, cleanup: fn()} })
    },
  }
  const jsx = (type, props) => ({type, props: props || {}})
  function load(name) {
    if (cache[name]) return cache[name].exports
    const module = {exports: {}}
    cache[name] = module
    vm.runInNewContext(fs.readFileSync(path.join(temporary, name + '.js'), 'utf8'), {module, exports: module.exports, require: localRequire, Error, Date, Intl, Number, Object, String, Array, Map, Set, Promise, URLSearchParams})
    return module.exports
  }
  function localRequire(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'Fragment'}
    if (name === 'lucide-react' || name === './ui') return new Proxy({}, {get: (_, key) => key})
    if (name === './styles-blog-editor.css') return {}
    if (name === './lib/supabase') return {
      authedApi: async (url, body) => {
        calls.push({url, body})
        const result = await api(url, body)
        if (url === '/api/blog-admin/save' && result?.post) savedPosts.set(result.post.id, result.post)
        return result
      },
      authedGet: async url => {
        reads.push(url)
        if (url === '/api/blog-admin/list') return {posts: initialPosts, categories: []}
        if (read) return read(url)
        const post = [...savedPosts.values(), ...initialPosts].find(item => url === `/api/blog-admin/read?id=${item.id}`)
        if (post) return {post, audit: initialAudit}
        throw Error('Unexpected read ' + url)
      },
    }
    if (name === './lib/aiActionDisplay') return load('lib/aiActionDisplay')
    if (name === './lib/shopTime' || name === './shopTime') return load('lib/shopTime')
    if (name === './types' || name === '../types') return load('types')
    throw Error('Unexpected dependency ' + name)
  }
  const {MasterBlogPanel} = load('MasterBlogPanel')
  function find(predicate, required = true) {
    function visit(node) {
      if (!node || typeof node !== 'object') return null
      if (Array.isArray(node)) {
        for (const child of node) { const found = visit(child); if (found) return found }
        return null
      }
      if (node.type && predicate(node)) return node
      if (node.props) for (const child of Object.values(node.props)) { const found = visit(child); if (found) return found }
      return null
    }
    const found = visit(tree)
    if (required) assert(found, 'Expected blog editor control')
    return found
  }
  return {
    calls, reads, notifications, find,
    render() { index = 0; effects = []; tree = MasterBlogPanel({notify: (...args) => notifications.push(args)}); effects.forEach(fn => fn()); return tree },
    field(label) { return find(node => node.type === 'Field' && node.props.label === label).props.children },
    button(label) { return find(node => node.type === 'button' && text(node.props.children).trim() === label) },
    modal(title) { return find(node => node.type === 'Modal' && node.props.title === title) },
  }
}
function text(value) {
  if (value == null || typeof value === 'boolean') return ''
  if (Array.isArray(value)) return value.map(text).join('')
  if (typeof value === 'object') return value.props ? text(value.props.children) : ''
  return String(value)
}
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return {promise, resolve} }
const post = {id: '00000000-0000-0000-0000-000000000001', slug: 'artigo-sintetico', title: 'Artigo sintético', excerpt: 'Resumo de teste', body_md: '## Conteúdo\n\nTexto sintético.', category_id: null, tags: [], status: 'draft', scheduled_at: null, published_at: null, ever_public: false, seo_title: '', seo_description: '', cover_url: '/blog/barbershop-hero.webp', cover_alt: 'Capa sintética', author_name: 'Equipe Barber System', revision: 7, updated_at: '2026-10-05T12:00:00Z'}
function saved(body, revision = 1) { return {post: {...post, ...body.values, id: body.id || post.id, revision}} }
async function ready(h) { h.render(); await flush(); h.render() }
async function click(h, label) {
  const button = h.button(label)
  assert(!button.props.disabled, 'Control unexpectedly disabled: ' + label)
  await button.props.onClick()
  await flush()
  h.render()
}
function change(h, label, value) { h.field(label).props.onChange({target: {value}}); h.render() }
async function newArticle(h) {
  await ready(h)
  await click(h, 'Novo artigo')
  change(h, 'Título', post.title)
  change(h, 'Endereço permanente', post.slug)
  change(h, 'Conteúdo em Markdown', post.body_md)
}
async function editArticle(h, item = post) {
  await ready(h)
  h.find(node => node.type === 'DataTable').props.columns.find(column => column.key === 'edit').render(item).props.onClick()
  await flush()
  h.render()
}

test('publish and schedule send no write until the corresponding explicit confirmation', async () => {
  const h = harness(async (_url, body) => saved(body))
  await newArticle(h)
  await click(h, 'Publicar agora')
  assert.equal(h.calls.length, 0)
  assert(h.modal('Publicar artigo agora?'))
  await click(h, 'Voltar à edição')
  assert.equal(h.calls.length, 0)
  change(h, 'Agendar para (horário de Brasília)', '2030-06-15T10:30')
  await click(h, 'Agendar')
  assert.equal(h.calls.length, 0)
  assert(h.modal('Agendar publicação?'))
  await click(h, 'Confirmar agendamento')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].url, '/api/blog-admin/save')
  assert.equal(h.calls[0].body.values.status, 'scheduled')
  assert.equal(h.calls[0].body.values.scheduled_at, '2030-06-15T13:30:00.000Z')
  await click(h, 'Publicar agora')
  assert.equal(h.calls.length, 1)
  await click(h, 'Confirmar publicação')
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].body.id, post.id)
  assert.equal(h.calls[1].body.expected_revision, 1)
  assert.equal(h.calls[1].body.values.status, 'published')
})

test('taking a public article offline requires confirmation and preserves its permanent address', async () => {
  const publicPost = {...post, status: 'published', ever_public: true, published_at: '2026-10-05T12:00:00Z'}
  const h = harness(async (_url, body) => saved(body, 8), [publicPost])
  await editArticle(h, publicPost)
  assert.equal(h.field('Endereço permanente').props.disabled, true)
  await click(h, 'Salvar rascunho')
  assert.equal(h.calls.length, 0)
  assert(h.modal('Retirar artigo do ar?'))
  await click(h, 'Confirmar rascunho')
  assert.equal(h.calls[0].body.id, post.id)
  assert.equal(h.calls[0].body.expected_revision, 7)
  assert.equal(h.calls[0].body.values.slug, post.slug)
  assert.equal(h.calls[0].body.values.status, 'draft')
})

test('consecutive draft saves reuse the returned article id and revision instead of creating another record', async () => {
  let revision = 0
  const h = harness(async (_url, body) => saved(body, ++revision))
  await newArticle(h)
  await click(h, 'Salvar rascunho')
  assert.equal(h.calls[0].body.id, null)
  assert.equal(h.calls[0].body.expected_revision, null)
  assert.equal(h.modal('Editar artigo').props.subtitle, 'Rascunho · versão 1')
  change(h, 'Título', 'Título revisado uma vez')
  await click(h, 'Salvar rascunho')
  change(h, 'Título', 'Título revisado duas vezes')
  await click(h, 'Salvar rascunho')
  assert.equal(h.calls.length, 3)
  assert.equal(h.calls[1].body.id, post.id)
  assert.equal(h.calls[1].body.expected_revision, 1)
  assert.equal(h.calls[2].body.id, post.id)
  assert.equal(h.calls[2].body.expected_revision, 2)
  assert.equal(h.calls[2].body.values.title, 'Título revisado duas vezes')
  assert.equal(h.modal('Editar artigo').props.subtitle, 'Rascunho · versão 3')
})

test('private preview only calls preview, keeps the unsaved editor and renders HTML inside a script-free sandbox', async () => {
  const html = '<!doctype html><h1>Prévia sintética</h1><script>blocked()</script>'
  const h = harness(async () => ({html}))
  await newArticle(h)
  await click(h, 'Prévia')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].url, '/api/blog-admin/preview')
  assert.deepEqual(Object.keys(h.calls[0].body), ['values'])
  assert.equal(h.notifications.length, 0)
  assert(h.modal('Novo artigo'))
  const frame = h.find(node => node.type === 'iframe')
  assert.equal(frame.props.srcDoc, html)
  assert.equal(frame.props.sandbox, 'allow-same-origin')
  assert(!frame.props.sandbox.includes('allow-scripts'))
  h.modal('Prévia privada do artigo').props.onClose()
  h.render()
  assert.equal(h.field('Título').props.value, post.title)
  assert(!h.find(node => node.type === 'iframe', false))
  assert(!h.find(node => node.type === 'a' && node.props.className === 'blog-public-link', false))
})

test('the editor and publication confirmation cannot close while a save is pending, then close after completion', async () => {
  const pending = deferred()
  const h = harness(() => pending.promise)
  await newArticle(h)
  await click(h, 'Publicar agora')
  h.button('Confirmar publicação').props.onClick()
  h.render()
  assert.equal(h.calls.length, 1)
  assert.equal(h.button('Confirmar publicação').props.disabled, true)
  assert.equal(h.button('Voltar à edição').props.disabled, true)
  assert.equal(h.button('Salvar rascunho').props.disabled, true)
  assert.equal(h.button('Novo artigo').props.disabled, true)
  h.modal('Publicar artigo agora?').props.onClose()
  h.modal('Novo artigo').props.onClose()
  h.render()
  assert(h.modal('Publicar artigo agora?'))
  assert(h.modal('Novo artigo'))
  pending.resolve(saved(h.calls[0].body))
  await flush()
  h.render()
  assert(!h.find(node => node.type === 'Modal' && node.props.title === 'Publicar artigo agora?', false))
  assert.equal(h.modal('Editar artigo').props.subtitle, 'Publicado · versão 1')
  h.modal('Editar artigo').props.onClose()
  h.render()
  assert(!h.find(node => node.type === 'Modal', false))
})

test('a rejected save leaves the article and revision intact and does not report success', async () => {
  const h = harness(async () => { throw Error('Este artigo mudou. Recarregue antes de salvar.') }, [post])
  await editArticle(h)
  change(h, 'Título', 'Edição que precisa ser preservada')
  await click(h, 'Salvar rascunho')
  assert.equal(h.modal('Editar artigo').props.subtitle, 'Rascunho · versão 7')
  assert.equal(h.field('Título').props.value, 'Edição que precisa ser preservada')
  assert.equal(h.notifications.length, 0)
  assert(h.find(node => node.type === 'Notice' && String(node.props.text).includes('Recarregue')))
  assert.equal(h.button('Salvar rascunho').props.disabled, false)
})

test('saving refreshes the visible audit automatically after creation and each following revision', async () => {
  let revision = 0, latest, history = []
  const h = harness(async (_url, body) => {
    const result = saved(body, ++revision)
    latest = result.post
    history.unshift({action: revision === 1 ? 'create' : 'update', status_before: revision === 1 ? null : 'draft', status_after: 'draft', revision, created_at: '2026-10-05T12:00:00Z', changed_fields: ['title']})
    return result
  }, [], [], async url => {
    assert.equal(url, `/api/blog-admin/read?id=${post.id}`)
    return {post: latest, audit: [...history]}
  })
  await newArticle(h)
  await click(h, 'Salvar rascunho')
  const auditText = () => text(h.find(node => node.type === 'details' && text(node.props.children).includes('Histórico recente')).props.children)
  assert(auditText().includes('versão 1 · Criado'))
  assert.equal(h.reads.filter(url => url.startsWith('/api/blog-admin/read')).length, 1)
  change(h, 'Título', 'Título com histórico atualizado')
  await click(h, 'Salvar rascunho')
  assert(auditText().includes('versão 2 · Atualizado'))
  assert(auditText().includes('versão 1 · Criado'))
  assert.equal(h.reads.filter(url => url.startsWith('/api/blog-admin/read')).length, 2)
  assert.equal(h.calls[1].body.id, post.id)
  assert.equal(h.calls[1].body.expected_revision, 1)
})

test('an audit refresh failure keeps the committed revision and reports that saving succeeded', async () => {
  let reads = 0
  const oldAudit = [{action: 'update', status_before: 'draft', status_after: 'draft', revision: 7, created_at: '2026-10-05T11:00:00Z', changed_fields: ['title']}]
  const h = harness(async (_url, body) => saved(body, 8), [post], oldAudit, async () => {
    if (++reads === 1) return {post, audit: oldAudit}
    throw Error('Read unavailable')
  })
  await editArticle(h)
  change(h, 'Título', 'Conteúdo salvo apesar da falha de leitura')
  await click(h, 'Salvar rascunho')
  assert.equal(h.calls.length, 1)
  assert.equal(h.modal('Editar artigo').props.subtitle, 'Rascunho · versão 8')
  assert.equal(h.field('Título').props.value, 'Conteúdo salvo apesar da falha de leitura')
  assert.equal(h.notifications.length, 1)
  assert(h.notifications[0][0].includes('registrado'))
  assert(h.find(node => node.type === 'Notice' && String(node.props.text).includes('O artigo foi salvo')))
  assert(!h.find(node => node.type === 'details' && text(node.props.children).includes('Histórico recente'), false))
  assert.equal(h.button('Salvar rascunho').props.disabled, false)
})

test('refreshing the audit does not replace text edited while the history request is pending', async () => {
  const pending = deferred()
  const h = harness(async (_url, body) => saved(body, 1), [], [], () => pending.promise)
  await newArticle(h)
  h.button('Salvar rascunho').props.onClick()
  await flush()
  h.render()
  assert.equal(h.button('Salvar rascunho').props.disabled, true)
  change(h, 'Título', 'Texto ainda não salvo durante a atualização')
  pending.resolve({post: {...post, revision: 2, title: 'Alteração externa que não deve substituir o formulário'}, audit: [{action: 'update', status_after: 'draft', revision: 2, created_at: '2026-10-05T12:00:00Z', changed_fields: ['title']}]})
  await flush()
  h.render()
  assert.equal(h.field('Título').props.value, 'Texto ainda não salvo durante a atualização')
  assert.equal(h.modal('Editar artigo').props.subtitle, 'Rascunho · versão 1')
  assert.equal(h.button('Salvar rascunho').props.disabled, false)
})
