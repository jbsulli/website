const {EditorState, Selection, NodeSelection} = require("prosemirror-state")
const {MenuBarEditorView} = require("prosemirror-menu")
const {DOMParser} = require("prosemirror-model")
const {schema} = require("prosemirror-schema-basic")
const {exampleSetup} = require("prosemirror-example-setup")
const {undo, redo} = require("prosemirror-history")
const {keymap} = require("prosemirror-keymap")
const CodeMirror = require("codemirror")
require("codemirror/mode/javascript/javascript")

let view, menuView

function computeChange(oldVal, newVal) {
  let start = 0, oldEnd = oldVal.length, newEnd = newVal.length
  while (start < oldEnd && oldVal.charCodeAt(start) == newVal.charCodeAt(start)) ++start
  while (oldEnd > start && newEnd > start &&
         oldVal.charCodeAt(oldEnd - 1) == newVal.charCodeAt(newEnd - 1)) { oldEnd--; newEnd-- }
  return {from: start, to: oldEnd, text: newVal.slice(start, newEnd)}
}

class CodeBlockView {
  constructor(node, view, getPos) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.value = node.textContent
    let mod = /Mac/.test(navigator.platform) ? "Cmd" : "Ctrl"
    this.cm = new CodeMirror(null, {
      value: this.value,
      mode: "javascript",
      lineNumbers: true,
      extraKeys: CodeMirror.normalizeKeyMap({
        Up: () => this.maybeEscape("line", -1),
        Left: () => this.maybeEscape("char", -1),
        Down: () => this.maybeEscape("line", 1),
        Right: () => this.maybeEscape("char", 1),
        [`${mod}-Z`]: () => undo(this.view.state, this.view.dispatch),
        [`Shift-${mod}-Z`]: () => redo(this.view.state, this.view.dispatch),
        [`${mod}-Y`]: () => redo(this.view.state, this.view.dispatch)
      })
    })
    setTimeout(() => this.cm.refresh(), 20)
    this.cm.on("focus", () => {
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, this.getPos())))
    })

    this.dom = this.cm.getWrapperElement()

    this.updating = false
    this.cm.on("changes", () => {if (!this.updating) this.valueChanged()})
  }

  valueChanged() {
    let value = this.cm.getValue()
    if (value != this.value) {
      let change = computeChange(this.value, value)
      this.value = value
      let start = this.getPos() + 1
      let tr = this.view.state.tr.replaceWith(start + change.from, start + change.to,
                                              change.text ? schema.text(change.text) : null)
      this.view.dispatch(tr)
    }
  }

  maybeEscape(unit, dir) {
    let pos = this.cm.getCursor()
    if (this.cm.somethingSelected() || pos.line != (dir < 0 ? this.cm.firstLine() : this.cm.lastLine()) ||
        (unit == "char" && pos.ch != (dir < 0 ? 0 : this.cm.getLine(pos.line).length)))
      return CodeMirror.Pass
    this.view.focus()
    let targetPos = this.getPos() + (dir < 0 ? 0 : this.value.length + 2)
    this.view.dispatch(this.view.state.tr.setSelection(Selection.near(this.view.state.doc.resolve(targetPos), dir)).scrollIntoView())
    this.view.focus()
  }

  update(node) {
    if (node.type != this.node.type) return false
    this.node = node
    let value = node.textContent
    if (value != this.value) {
      let change = computeChange(this.value, value)
      this.value = value
      this.updating = true
      this.cm.replaceRange(change.text, this.cm.posFromIndex(change.from), this.cm.posFromIndex(change.to), "docUpdate")
      this.updating = false
    }
    return true
  }

  setSelection(anchor, head) {
    this.cm.focus()
    this.cm.setSelection(this.cm.posFromIndex(anchor), this.cm.posFromIndex(head))
  }

  selectNode() {
    this.cm.focus()
  }

  stopEvent() { return true }
}

function arrowHandler(dir) {
  return (state, dispatch, view) => {
    if (state.selection.empty && view.endOfTextblock(dir)) {
      let side = dir == "left" || dir == "up" ? -1 : 1, $head = state.selection.$head
      let nextPos = Selection.near(state.doc.resolve(side > 0 ? $head.after() : $head.before()), side)
      if (nextPos.$head && nextPos.$head.parent.type.name == "code_block") {
        dispatch(state.tr.setSelection(nextPos))
        return true
      }
    }
    return false
  }
}

const arrowHandlers = keymap({
  ArrowLeft: arrowHandler("left"),
  ArrowRight: arrowHandler("right"),
  ArrowUp: arrowHandler("up"),
  ArrowDown: arrowHandler("down")
})

menuView = new MenuBarEditorView(document.querySelector("#editor"), {
  state: EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(document.querySelector("#content")),
    plugins: exampleSetup({schema}).concat(arrowHandlers)
  }),
  handleClickOn(_view, _pos, node) { return node.type.name == "code_block" },
  nodeViews: {code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos)}
})
view = window.view = menuView.editor
