// Server Configuration
const PORT = process.env.PORT || 8000;
const CORS_ORIGIN = 'http://localhost:5173'; // Or your specific frontend origin

// Event Names
const EVENT_CONTROL_DATA = 'controlData';
const EVENT_SPEAK = 'speak';
const EVENT_SPEAK_ADVANCE = 'speakAdvance'; // For speak with percentage/rate/pitch
const EVENT_SPEAK_OVER = 'speakOver';       // From receiver when one speech segment is done
const EVENT_SPEAK_OVER_ALL = 'speakOverAll'; // To controller when all sentences in a request are done
const EVENT_SPEAK_CONFIG = 'speakConfig';
const EVENT_USER_CONNECT = 'userConnect';     // When a receiver connects and provides UUID
const EVENT_USER_DISCONNECT = 'userDisconnect'; // When a receiver disconnects
const EVENT_DEBUG = 'debug';
const EVENT_OSC = 'osc';
const EVENT_PAUSE = 'pause';                // To pause control loops or other activities
const EVENT_SHOW_CLIENT = 'showClient';     // Controller request to list clients

// Control Modes
const MODE_NORMAL = 'normal';
const MODE_TAKETURN = 'taketurn';

// Speak Configuration Sub-modes (used in EVENT_SPEAK_CONFIG payload)
const SPEAK_CONFIG_CHANGE_VOICE = 'changeVoice';    // Receiver changes its voice, or controller sets global
const SPEAK_CONFIG_NOW_SPEAK = 'nowSpeak';        // Server informs who is currently speaking
const SPEAK_CONFIG_CHANGE_TIMEOUT = 'changeTimeout';// Controller changes speak timeout parameters
const SPEAK_CONFIG_SHOW_USER = 'showUser';        // Controller requests user voice preferences

// Default Speak Timeout Values (can be overridden by SPEAK_CONFIG_CHANGE_TIMEOUT)
const SPEAK_TIMEOUT_DEFAULT_DELAY_MS = 700;
const SPEAK_TIMEOUT_DEFAULT_SPEED_FACTOR = 200;


module.exports = {
    // Server
    PORT,
    CORS_ORIGIN,

    // Event Names
    EVENT_CONTROL_DATA,
    EVENT_SPEAK,
    EVENT_SPEAK_ADVANCE,
    EVENT_SPEAK_OVER,
    EVENT_SPEAK_OVER_ALL,
    EVENT_SPEAK_CONFIG,
    EVENT_USER_CONNECT,
    EVENT_USER_DISCONNECT,
    EVENT_DEBUG,
    EVENT_OSC,
    EVENT_PAUSE,
    EVENT_SHOW_CLIENT,

    // Control Modes
    MODE_NORMAL,
    MODE_TAKETURN,

    // Speak Config Sub-modes
    SPEAK_CONFIG_CHANGE_VOICE,
    SPEAK_CONFIG_NOW_SPEAK,
    SPEAK_CONFIG_CHANGE_TIMEOUT,
    SPEAK_CONFIG_SHOW_USER,

    // Default Values
    SPEAK_TIMEOUT_DEFAULT_DELAY_MS,
    SPEAK_TIMEOUT_DEFAULT_SPEED_FACTOR,
};