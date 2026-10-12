// Registers the @font-face rules for every bundled font in fonts.ts. The
// browser only downloads the files a caption actually uses.
//
// Import this from modules that are compiled by a bundler (the Next.js editor
// and the Remotion entry) and never from the package index, which the API
// loads in plain Node.
import "@fontsource-variable/montserrat/wght.css";
import "@fontsource-variable/montserrat/wght-italic.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/fredoka/wght.css";
import "@fontsource-variable/oswald/wght.css";
import "@fontsource-variable/playfair-display/wght.css";
import "@fontsource-variable/playfair-display/wght-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource/poppins/900.css";
import "@fontsource/anton/400.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/archivo-black/400.css";
import "@fontsource/bangers/400.css";
import "@fontsource/permanent-marker/400.css";
