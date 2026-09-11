import { Component } from '@angular/core';
import { Greeting } from './greeting';

@Component({
  imports: [Greeting],
  selector: 'app-root',
  template: '<app-greeting name="World" />',
})
export class App {}
