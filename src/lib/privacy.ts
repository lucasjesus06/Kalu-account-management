export const HIDE_VALUES_CLASS = "blur-values";

export const HIDE_VALUES_STORAGE_KEY = "kalu:ocultar-valores";

export const restoreHideValuesScript = `try{if(localStorage.getItem("${HIDE_VALUES_STORAGE_KEY}")==="1")document.documentElement.classList.add("${HIDE_VALUES_CLASS}")}catch(e){}`;
