import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// Expose the registered Capacitor plugins to the existing non-module app code.
window.RCSpeechRecognition = SpeechRecognition;
window.RCTextToSpeech = TextToSpeech;
