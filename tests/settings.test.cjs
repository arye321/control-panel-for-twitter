const assert = require('node:assert/strict')
const {test} = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const options = fs.readFileSync('options.js', 'utf8')
const script = fs.readFileSync('script.js', 'utf8')

test('imports compatible settings across versions and preserves missing settings', async () => {
  let stored
  const status = {}
  const context = vm.createContext({
    defaultConfig: {enabled: true, version: 'desktop', retweets: 'hide', hideQuotesFrom: [], mutedQuotes: [], hidePostsByUserName: ''},
    optionsConfig: {enabled: true, version: 'mobile', hidePostsByUserName: 'existing'},
    document: {querySelector: () => status},
    $form: {querySelector: selector => selector.includes('retweets') ? {options: [{value: 'hide'}, {value: 'ignore'}]} : null},
    chrome: {storage: {local: {set: (changes, done) => { stored = changes; done() }}}, runtime: {}, i18n: {getMessage: key => key}},
    applyConfig() {},
  })
  vm.runInContext(options.slice(options.indexOf('async function importConfig'), options.indexOf('function formatFollowerCount')), context)
  const input = {files: [{text: async () => JSON.stringify({enabled: false, version: 'desktop', futureSetting: true, retweets: 'removed', hideQuotesFrom: [42], mutedQuotes: [null]})}], value: 'file'}
  await context.importConfig({target: input})
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), {enabled: false})
  assert.equal(context.optionsConfig.version, 'mobile')
  assert.equal(context.optionsConfig.hidePostsByUserName, 'existing')
  assert.equal(input.value, '')
  input.files[0].text = async () => '{broken'
  await context.importConfig({target: input})
  assert.equal(status.textContent, 'importConfigError')
})

test('matches author names and handles with comma delimiters, case folding and empty entries', () => {
  const context = vm.createContext({config: {hidePostsByUserName: ' , ALICE, bot_ , , '}})
  vm.runInContext(script.slice(script.indexOf('function shouldHidePostByUserName'), script.indexOf('function onTimelineChange')), context)
  const tweet = (name, handle) => ({querySelector: selector => {
    assert.equal(selector, '[data-testid="User-Name"]')
    return {querySelectorAll: () => [{pathname: '/' + handle, querySelectorAll: () => [{tagName: 'SPAN', childElementCount: 0, textContent: name}]}]}
  }})
  assert.equal(context.shouldHidePostByUserName(tweet('Alice Example', 'example')), true)
  assert.equal(context.shouldHidePostByUserName(tweet('Someone', 'Bot_123')), true)
  assert.equal(context.shouldHidePostByUserName(tweet('Someone', 'example')), false)
  context.config.hidePostsByUserName = ', , '
  assert.equal(context.shouldHidePostByUserName(tweet('Someone', 'example')), false)
  context.config.hidePostsByUserName = 'hello'
  assert.equal(context.shouldHidePostByUserName({querySelector: () => null}), false)
})

test('toolbar import opens persistent options instead of a popup file picker', () => {
  let replacement
  let opened = false
  const input = {replaceWith: button => { replacement = button }}
  const context = vm.createContext({
    $body: {classList: {contains: name => name === 'browserAction'}},
    document: {
      querySelector: () => input,
      createElement: () => ({addEventListener(event, callback) { this.click = callback }}),
    },
    chrome: {runtime: {openOptionsPage: () => { opened = true }}, i18n: {getMessage: () => 'Import settings'}},
  })
  vm.runInContext(options.slice(options.indexOf('function configureImportControl'), options.indexOf('/** Import only settings')), context)
  context.configureImportControl()
  assert.equal(replacement.type, 'button')
  replacement.click()
  assert.equal(opened, true)
})

test('file import persists replacements and refreshes actual form controls', async () => {
  const checkbox = {type: 'checkbox', checked: true}
  const textarea = {type: 'textarea', value: 'old filter'}
  const status = {}
  let persisted
  const context = vm.createContext({
    defaultConfig: {enabled: true, hidePostsByUserName: ''},
    optionsConfig: {enabled: true, hidePostsByUserName: 'old filter'},
    $form: {elements: {enabled: checkbox, hidePostsByUserName: textarea}, querySelector: () => null},
    document: {querySelector: () => status},
    RadioNodeList: class {},
    chrome: {
      runtime: {},
      storage: {local: {set: (changes, done) => { persisted = {...changes}; done() }}},
      i18n: {getMessage: key => key},
    },
  })
  vm.runInContext(options.slice(options.indexOf('async function importConfig'), options.indexOf('function formatFollowerCount')), context)
  vm.runInContext(options.slice(options.indexOf('function updateFormControls'), options.indexOf('//#endregion', options.indexOf('function updateFormControls'))), context)
  vm.runInContext('function applyConfig() { updateFormControls() }', context)
  const input = {files: [{text: async () => '\uFEFF' + JSON.stringify({enabled: false, hidePostsByUserName: 'new filter'})}], value: 'settings.json'}
  await context.importConfig({target: input})
  assert.deepEqual(persisted, {enabled: false, hidePostsByUserName: 'new filter'})
  assert.equal(checkbox.checked, false)
  assert.equal(textarea.value, 'new filter')
  assert.equal(status.textContent, 'importConfigSuccess')
})
