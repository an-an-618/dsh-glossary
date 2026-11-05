/**
 * Minimal browser runtime for the showcase gallery.
 *
 * It stands in for the two things the shipped app supplies at runtime: the
 * module loader table (`window.__ModuleLoader__`) and React. Only the pieces
 * the card component uses are implemented, and `useSyncExternalStore` returns
 * the snapshot without subscribing, so several cards for different entries can
 * be rendered one after another.
 */

;(function () {
  function h(type, props) {
    var children = []
    for (var i = 2; i < arguments.length; i++) children.push(arguments[i])
    var merged = {}
    if (props) for (var key in props) if (key !== 'key') merged[key] = props[key]
    merged.children = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type: type, props: merged }
  }

  var hooks = { cells: [], effectDeps: [], cursor: 0, effects: [] }
  var mounted = { component: null, props: null, container: null }
  var rendering = false
  var pending = false

  function scheduleRender() {
    if (mounted.component === null) return
    if (rendering) {
      pending = true
      return
    }
    render(mounted.component, mounted.props, mounted.container)
  }

  var React = {
    createElement: h,
    memo: function (component) { return component },
    useState: function (initial) {
      var index = hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? initial() : initial
      return [hooks.cells[index], function (next) {
        var value = typeof next === 'function' ? next(hooks.cells[index]) : next
        if (Object.is(value, hooks.cells[index])) return
        hooks.cells[index] = value
        scheduleRender()
      }]
    },
    useRef: function (initial) {
      var index = hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }
      return hooks.cells[index]
    },
    useEffect: function (effect, deps) { hooks.effects.push({ index: hooks.cursor++, effect: effect, deps: deps }) },
    useLayoutEffect: function (effect, deps) { hooks.effects.push({ index: hooks.cursor++, effect: effect, deps: deps }) },
    useSyncExternalStore: function (subscribe, getSnapshot) { return getSnapshot() },
  }

  function toDom(node) {
    if (node === null || node === undefined || node === false || node === true) return document.createTextNode('')
    if (Array.isArray(node)) {
      var fragment = document.createDocumentFragment()
      for (var i = 0; i < node.length; i++) fragment.appendChild(toDom(node[i]))
      return fragment
    }
    if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node))
    if (typeof node.type === 'function') return toDom(node.type(node.props))
    var element = document.createElement(node.type)
    var props = node.props || {}
    for (var name in props) {
      if (name === 'children' || name === 'ref' || name === 'tabIndex') continue
      var value = props[name]
      if (name === 'style' && value && typeof value === 'object') {
        for (var styleName in value) element.style[styleName] = value[styleName]
      } else if (name === 'className') {
        element.className = value
      } else if (typeof value === 'function' && name.indexOf('on') === 0) {
        element.addEventListener(name.slice(2).toLowerCase(), value)
      } else if (value !== undefined && value !== null && value !== false) {
        element.setAttribute(name, value === true ? '' : String(value))
      }
    }
    if (props.tabIndex !== undefined) element.setAttribute('tabindex', String(props.tabIndex))
    var children = props.children
    var list = Array.isArray(children) ? children : [children]
    for (var j = 0; j < list.length; j++) element.appendChild(toDom(list[j]))
    return element
  }

  function render(component, props, container) {
    mounted.component = component
    mounted.props = props
    mounted.container = container
    var iterations = 0
    do {
      pending = false
      rendering = true
      hooks.cursor = 0
      hooks.effects = []
      container.textContent = ''
      container.appendChild(toDom(component(props)))
      var effects = hooks.effects
      for (var i = 0; i < effects.length; i++) {
        var entry = effects[i]
        var previous = hooks.effectDeps[entry.index]
        var changed = !entry.deps || !previous || entry.deps.length !== previous.length
        if (!changed) {
          for (var d = 0; d < entry.deps.length; d++) {
            if (!Object.is(entry.deps[d], previous[d])) { changed = true; break }
          }
        }
        if (!changed) continue
        hooks.effectDeps[entry.index] = entry.deps
        entry.effect()
      }
      rendering = false
      iterations += 1
    } while (pending && iterations < 5)
  }

  window.__showcaseRender = render
  window.__ModuleLoader__ = {
    load: function (definition) {
      window.__GLOSSARY__ = definition.factory(function (id) {
        if (id === 'react') return React
        throw new Error('unexpected require: ' + id)
      })
    },
  }
})()
