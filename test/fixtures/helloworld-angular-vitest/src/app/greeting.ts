import { Component, computed, input } from '@angular/core';
import { hello } from './greet';

/** The one tested component. It shows the classic greeting; the villain is not wired in, on purpose. */
@Component({
  selector: 'app-greeting',
  template: '<h1>{{ text() }}</h1>',
})
export class Greeting {
  readonly name = input.required<string>();
  readonly text = computed(() => hello(this.name()));
}
