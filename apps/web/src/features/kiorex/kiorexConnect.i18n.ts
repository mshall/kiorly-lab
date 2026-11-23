import i18n from "@/lib/i18n";
import { ar, en, nav } from "./kiorexConnect.strings";

/** Own bundle (the shared locale files stay untouched), merged at import. Also provides the nav label. */
i18n.addResourceBundle("en", "translation", { kiorexConnect: en, nav: { kiorexConnect: nav.en } }, true, false);
i18n.addResourceBundle("ar", "translation", { kiorexConnect: ar, nav: { kiorexConnect: nav.ar } }, true, false);
