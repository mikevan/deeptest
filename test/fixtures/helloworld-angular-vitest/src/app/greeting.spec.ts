import { TestBed } from '@angular/core/testing';
import { Greeting } from './greeting';

describe('Greeting', () => {
  it('renders the classic greeting', async () => {
    await TestBed.configureTestingModule({ imports: [Greeting] }).compileComponents();
    const fixture = TestBed.createComponent(Greeting);
    fixture.componentRef.setInput('name', 'Jeff');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe('Hello, Jeff!');
  });
});
