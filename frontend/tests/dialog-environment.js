// jsdom exposes HTMLDialogElement, but leaves native modal methods to browsers.
const dialogPrototype = HTMLDialogElement.prototype

dialogPrototype.showModal ??= function () {
  this.open = true
}

dialogPrototype.close ??= function () {
  this.open = false
}
