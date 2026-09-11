<script lang="ts">
/**
 * The villain, inside a single-file component.
 *
 * pickGreeting() works, mostly, but nobody wrote a test for it and it is
 * nested five levels deep. This is the function DeepTest should put at the
 * top of its report, and the one UntangleIt should be pointed at afterwards.
 * It lives in a .vue file on purpose: the toolkit has to read the script
 * block of a single-file component to find it.
 */
import { defineComponent } from 'vue';

export function pickGreeting(hour: number, name: string, lang = 'en', formal = false, mood = 'ok'): string {
  if (lang === 'en') {
    if (hour < 12) {
      if (formal) {
        if (mood === 'great') {
          return `Good morning, ${name}. What a fine day.`;
        } else if (mood === 'bad') {
          return `Good morning, ${name}. I hope it improves.`;
        } else {
          return `Good morning, ${name}.`;
        }
      } else {
        if (mood === 'great') {
          return `Morning, ${name}! Feeling good?`;
        } else if (mood === 'bad') {
          return `Morning, ${name}. Rough one?`;
        } else {
          return `Morning, ${name}!`;
        }
      }
    } else if (hour < 18) {
      if (formal) {
        if (mood === 'great') {
          return `Good afternoon, ${name}. Splendid.`;
        } else if (mood === 'bad') {
          return `Good afternoon, ${name}. Chin up.`;
        } else {
          return `Good afternoon, ${name}.`;
        }
      } else {
        if (mood === 'great' || mood === 'ok') {
          return `Hey ${name}!`;
        } else {
          return `Hey ${name}. Hang in there.`;
        }
      }
    } else {
      if (formal) {
        return `Good evening, ${name}.`;
      } else {
        if (mood === 'bad') {
          return `Evening, ${name}. Long day?`;
        } else {
          return `Evening, ${name}!`;
        }
      }
    }
  } else if (lang === 'es') {
    if (hour < 12) {
      if (formal) {
        return `Buenos dias, ${name}.`;
      } else {
        return `Buenas, ${name}!`;
      }
    } else if (hour < 20) {
      if (formal && mood !== 'bad') {
        return `Buenas tardes, ${name}.`;
      } else if (formal) {
        return `Buenas tardes, ${name}. Animo.`;
      } else {
        return `Buenas, ${name}!`;
      }
    } else {
      return `Buenas noches, ${name}.`;
    }
  } else if (lang === 'fr') {
    if (hour < 18) {
      if (formal) {
        return `Bonjour, ${name}.`;
      } else {
        return `Salut, ${name}!`;
      }
    } else {
      return `Bonsoir, ${name}.`;
    }
  } else {
    if (formal) {
      return `Hello, ${name}.`;
    } else {
      return `Hello, ${name}!`;
    }
  }
}

export default defineComponent({
  name: 'GreetingPicker',
  props: { hour: { type: Number, required: true }, name: { type: String, required: true }, lang: { type: String, default: 'en' }, formal: { type: Boolean, default: false }, mood: { type: String, default: 'ok' } },
  computed: {
    text(): string {
      return pickGreeting(this.hour, this.name, this.lang, this.formal, this.mood);
    },
  },
});
</script>

<template>
  <p>{{ text }}</p>
</template>
