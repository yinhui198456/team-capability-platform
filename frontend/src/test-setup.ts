// Issue #93: unit tests assert responsive CSS contracts, so the shared
// stylesheets must reach the jsdom document (main.tsx imports them in prod).
import './styles/global.css'
import './styles.css'
