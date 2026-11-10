/**
 * Diccionario de denominaciones de piezas.
 *
 * Sirve para interpretar lo que escribe el trabajador ("alternador", "dinamo", "motor arranque",
 * "compresor del aire"…) y convertirlo en un código de pieza estable. Cada pieza declara qué
 * características técnicas hay que comparar para validar una compatibilidad (amperaje, dientes,
 * lado de montaje…). Se puede ampliar desde Configuración → Sinónimos sin tocar el código.
 */

export interface SpecKey {
  key: string;
  label: string;
  unit?: string;
}

export interface PartType {
  code: string;
  name: string;
  category: string;
  synonyms: string[];
  /** La pieza existe en versión izquierda/derecha. */
  sided?: boolean;
  /** La pieza existe en versión delantera/trasera. */
  axle?: boolean;
  specs: SpecKey[];
}

const S = {
  amperage: { key: "amperaje", label: "Amperaje", unit: "A" },
  voltage: { key: "tension", label: "Tensión", unit: "V" },
  powerKw: { key: "potencia_kw", label: "Potencia", unit: "kW" },
  pulley: { key: "polea", label: "Tipo de polea" },
  grooves: { key: "ranuras", label: "Nº de ranuras polea" },
  teeth: { key: "dientes", label: "Nº de dientes" },
  connector: { key: "conector", label: "Conector eléctrico" },
  pins: { key: "pines", label: "Nº de pines" },
  diameter: { key: "diametro_mm", label: "Diámetro", unit: "mm" },
  length: { key: "longitud_mm", label: "Longitud", unit: "mm" },
  width: { key: "anchura_mm", label: "Anchura", unit: "mm" },
  thickness: { key: "espesor_mm", label: "Espesor", unit: "mm" },
  gearbox: { key: "codigo_caja", label: "Código de caja" },
  gears: { key: "marchas", label: "Nº de marchas" },
  refrigerant: { key: "refrigerante", label: "Refrigerante" },
  lampType: { key: "tipo_lampara", label: "Tipo de iluminación" },
  heated: { key: "calefactado", label: "Calefactado" },
  folding: { key: "abatible_electrico", label: "Abatible eléctrico" },
  turbineType: { key: "tipo_turbo", label: "Tipo de turbo" },
  injectorType: { key: "tipo_inyector", label: "Tipo de inyector" },
  vented: { key: "ventilado", label: "Ventilado" },
  rotation: { key: "giro", label: "Sentido de giro" },
};

export const PART_TYPES: PartType[] = [
  // Sistema eléctrico
  { code: "ALTERNADOR", name: "Alternador", category: "Sistema eléctrico", synonyms: ["alternador", "dinamo", "generador", "alterandor", "altenador"], specs: [S.amperage, S.voltage, S.pulley, S.grooves, S.connector] },
  { code: "MOTOR_ARRANQUE", name: "Motor de arranque", category: "Sistema eléctrico", synonyms: ["motor de arranque", "motor arranque", "arranque", "burro de arranque", "motor de arrancar", "starter"], specs: [S.powerKw, S.voltage, S.teeth, S.rotation] },
  { code: "BATERIA", name: "Batería", category: "Sistema eléctrico", synonyms: ["bateria", "acumulador"], specs: [S.amperage, S.voltage] },
  { code: "BOBINA_ENCENDIDO", name: "Bobina de encendido", category: "Sistema eléctrico", synonyms: ["bobina", "bobina de encendido", "bobina encendido"], specs: [S.connector, S.pins] },
  { code: "BUJIA_INCANDESCENCIA", name: "Bujía de incandescencia", category: "Sistema eléctrico", synonyms: ["calentador", "calentadores", "bujia de incandescencia", "bujia precalentamiento"], specs: [S.voltage, S.length] },
  { code: "BUJIA", name: "Bujía de encendido", category: "Sistema eléctrico", synonyms: ["bujia", "bujias", "bujia de encendido"], specs: [] },
  { code: "CENTRALITA_MOTOR", name: "Centralita de motor (ECU)", category: "Sistema eléctrico", synonyms: ["centralita", "centralita motor", "ecu", "unidad de control motor", "calculador motor"], specs: [S.connector, S.pins] },
  { code: "ELEVALUNAS", name: "Elevalunas", category: "Carrocería", sided: true, axle: true, synonyms: ["elevalunas", "elevador de cristal", "mecanismo elevalunas", "motor elevalunas"], specs: [S.connector, S.pins] },
  // Motor
  { code: "TURBO", name: "Turbocompresor", category: "Motor", synonyms: ["turbo", "turbocompresor", "turbo compresor", "turbina"], specs: [S.turbineType] },
  { code: "INYECTOR", name: "Inyector", category: "Alimentación", synonyms: ["inyector", "inyectores", "injector"], specs: [S.injectorType, S.connector] },
  { code: "BOMBA_INYECCION", name: "Bomba de inyección", category: "Alimentación", synonyms: ["bomba de inyeccion", "bomba inyectora", "bomba alta presion", "bomba de alta presion", "bomba de alta"], specs: [] },
  { code: "VALVULA_EGR", name: "Válvula EGR", category: "Motor", synonyms: ["egr", "valvula egr", "valvula de recirculacion", "recirculacion de gases"], specs: [S.connector, S.pins] },
  { code: "BOMBA_AGUA", name: "Bomba de agua", category: "Refrigeración", synonyms: ["bomba de agua", "bomba agua", "bomba refrigerante"], specs: [S.teeth, S.diameter] },
  { code: "KIT_DISTRIBUCION", name: "Kit de distribución", category: "Motor", synonyms: ["kit de distribucion", "distribucion", "correa de distribucion", "kit distribucion"], specs: [S.teeth, S.width] },
  { code: "CADENA_DISTRIBUCION", name: "Kit de cadena de distribución", category: "Motor", synonyms: ["cadena de distribucion", "kit cadena", "cadena distribucion"], specs: [] },
  { code: "CORREA_AUXILIAR", name: "Correa auxiliar / poli-V", category: "Motor", synonyms: ["correa auxiliar", "correa de accesorios", "correa poli v", "correa alternador", "correa serpentina"], specs: [S.grooves, S.length] },
  { code: "TENSOR_CORREA", name: "Tensor de correa", category: "Motor", synonyms: ["tensor", "tensor de correa", "tensor correa auxiliar"], specs: [] },
  { code: "BOMBA_ACEITE", name: "Bomba de aceite", category: "Motor", synonyms: ["bomba de aceite", "bomba aceite"], specs: [] },
  { code: "CULATA", name: "Culata", category: "Motor", synonyms: ["culata", "tapa de cilindros"], specs: [] },
  { code: "MOTOR_COMPLETO", name: "Motor completo", category: "Motor", synonyms: ["motor", "motor completo", "motor entero", "bloque motor"], specs: [] },
  { code: "CAUDALIMETRO", name: "Caudalímetro", category: "Motor", synonyms: ["caudalimetro", "medidor de masa de aire", "maf", "sensor de flujo de aire"], specs: [S.connector, S.pins] },
  { code: "FILTRO_PARTICULAS", name: "Filtro de partículas (FAP/DPF)", category: "Escape", synonyms: ["fap", "dpf", "filtro de particulas", "filtro antiparticulas"], specs: [] },
  { code: "CATALIZADOR", name: "Catalizador", category: "Escape", synonyms: ["catalizador", "catalitico"], specs: [] },
  { code: "VOLANTE_MOTOR", name: "Volante motor bimasa", category: "Transmisión", synonyms: ["volante bimasa", "bimasa", "volante motor", "volante de inercia"], specs: [S.teeth, S.diameter] },
  // Transmisión
  { code: "CAJA_CAMBIOS", name: "Caja de cambios", category: "Transmisión", synonyms: ["caja de cambios", "caja cambios", "cambio", "caja de velocidades", "transmision", "caja"], specs: [S.gearbox, S.gears] },
  { code: "KIT_EMBRAGUE", name: "Kit de embrague", category: "Transmisión", synonyms: ["embrague", "kit de embrague", "kit embrague", "disco de embrague", "plato de embrague"], specs: [S.diameter, S.teeth] },
  { code: "PALIER", name: "Palier / transmisión", category: "Transmisión", sided: true, axle: true, synonyms: ["palier", "semieje", "eje de transmision", "transmision lateral"], specs: [S.length, S.teeth] },
  // Climatización
  { code: "COMPRESOR_AC", name: "Compresor de aire acondicionado", category: "Climatización", synonyms: ["compresor de aire acondicionado", "compresor aire acondicionado", "compresor ac", "compresor a c", "compresor del aire", "compresor de aire", "compresor clima", "compresor"], specs: [S.refrigerant, S.pulley, S.grooves, S.connector] },
  { code: "CONDENSADOR_AC", name: "Condensador de aire acondicionado", category: "Climatización", synonyms: ["condensador", "condensador aire acondicionado", "radiador aire acondicionado", "condensador ac"], specs: [S.refrigerant, S.width] },
  { code: "RADIADOR", name: "Radiador de refrigeración", category: "Refrigeración", synonyms: ["radiador", "radiador motor", "radiador de agua"], specs: [S.width, S.length] },
  { code: "INTERCOOLER", name: "Intercooler", category: "Motor", synonyms: ["intercooler", "intercambiador", "radiador de aire"], specs: [] },
  { code: "ELECTROVENTILADOR", name: "Electroventilador", category: "Refrigeración", synonyms: ["electroventilador", "ventilador", "ventilador radiador", "motoventilador"], specs: [S.diameter, S.connector] },
  { code: "MOTOR_CALEFACCION", name: "Motor de calefacción / soplador", category: "Climatización", synonyms: ["motor calefaccion", "ventilador habitaculo", "soplador", "motor ventilador calefaccion"], specs: [S.connector] },
  // Frenos y suspensión
  { code: "PASTILLAS_FRENO", name: "Pastillas de freno", category: "Frenos", axle: true, synonyms: ["pastillas", "pastillas de freno", "pastillas freno", "zapatas de disco"], specs: [S.width, S.thickness] },
  { code: "DISCO_FRENO", name: "Disco de freno", category: "Frenos", axle: true, synonyms: ["disco de freno", "discos de freno", "disco freno", "discos"], specs: [S.diameter, S.thickness, S.vented] },
  { code: "PINZA_FRENO", name: "Pinza de freno", category: "Frenos", sided: true, axle: true, synonyms: ["pinza de freno", "pinza freno", "caliper", "pinza"], specs: [S.diameter] },
  { code: "BOMBA_ABS", name: "Grupo hidráulico ABS", category: "Frenos", synonyms: ["abs", "bomba abs", "grupo abs", "modulo abs", "centralita abs"], specs: [S.connector] },
  { code: "AMORTIGUADOR", name: "Amortiguador", category: "Suspensión", sided: true, axle: true, synonyms: ["amortiguador", "amortiguadores", "amortiguacion"], specs: [] },
  { code: "MANGUETA", name: "Mangueta", category: "Suspensión", sided: true, axle: true, synonyms: ["mangueta", "portamangueta", "buje con mangueta"], specs: [] },
  { code: "BRAZO_SUSPENSION", name: "Brazo de suspensión / trapecio", category: "Suspensión", sided: true, axle: true, synonyms: ["trapecio", "brazo de suspension", "brazo suspension", "horquilla"], specs: [] },
  { code: "CREMALLERA_DIRECCION", name: "Cremallera de dirección", category: "Dirección", synonyms: ["cremallera", "cremallera de direccion", "caja de direccion", "direccion asistida"], specs: [] },
  { code: "BOMBA_DIRECCION", name: "Bomba de dirección asistida", category: "Dirección", synonyms: ["bomba de direccion", "bomba direccion asistida", "bomba de la direccion"], specs: [] },
  // Carrocería e iluminación
  { code: "FARO_DELANTERO", name: "Faro delantero", category: "Iluminación", sided: true, synonyms: ["faro", "faro delantero", "optica", "optica delantera", "faros", "proyector delantero"], specs: [S.lampType, S.connector] },
  { code: "PILOTO_TRASERO", name: "Piloto trasero", category: "Iluminación", sided: true, synonyms: ["piloto", "piloto trasero", "luz trasera", "faro trasero", "pilotos"], specs: [S.lampType, S.connector] },
  { code: "ANTINIEBLA", name: "Faro antiniebla", category: "Iluminación", sided: true, synonyms: ["antiniebla", "faro antiniebla", "luz antiniebla"], specs: [S.lampType] },
  { code: "RETROVISOR", name: "Retrovisor exterior", category: "Carrocería", sided: true, synonyms: ["retrovisor", "espejo", "espejo retrovisor", "retrovisor exterior", "retro"], specs: [S.heated, S.folding, S.pins] },
  { code: "PARAGOLPES", name: "Paragolpes", category: "Carrocería", axle: true, synonyms: ["paragolpes", "parachoques", "defensa"], specs: [] },
  { code: "CAPO", name: "Capó", category: "Carrocería", synonyms: ["capo", "capot", "tapa motor"], specs: [] },
  { code: "ALETA", name: "Aleta", category: "Carrocería", sided: true, axle: true, synonyms: ["aleta", "guardabarros"], specs: [] },
  { code: "PUERTA", name: "Puerta", category: "Carrocería", sided: true, axle: true, synonyms: ["puerta", "puertas"], specs: [] },
  { code: "PORTON", name: "Portón / tapa maletero", category: "Carrocería", synonyms: ["porton", "porton trasero", "tapa maletero", "tapa de maletero", "maletero"], specs: [] },
  { code: "CERRADURA", name: "Cerradura de puerta", category: "Carrocería", sided: true, axle: true, synonyms: ["cerradura", "cerradura puerta", "bombin", "motor cierre centralizado"], specs: [S.pins] },
  { code: "LUNA", name: "Luna / parabrisas", category: "Carrocería", synonyms: ["luna", "parabrisas", "luneta", "cristal delantero"], specs: [] },
  { code: "AIRBAG", name: "Airbag", category: "Seguridad", synonyms: ["airbag", "air bag", "bolsa de aire"], specs: [S.connector] },
  { code: "CUADRO_INSTRUMENTOS", name: "Cuadro de instrumentos", category: "Sistema eléctrico", synonyms: ["cuadro", "cuadro de instrumentos", "cuentakilometros", "marcador", "relojes"], specs: [S.connector] },
  { code: "DEPOSITO_COMBUSTIBLE", name: "Depósito de combustible", category: "Alimentación", synonyms: ["deposito", "deposito de combustible", "deposito gasoil", "tanque"], specs: [] },
  { code: "BOMBA_COMBUSTIBLE", name: "Bomba de combustible / aforador", category: "Alimentación", synonyms: ["bomba de combustible", "bomba gasolina", "bomba gasoil", "aforador", "bomba de cebado", "bomba electrica combustible"], specs: [S.connector] },
  { code: "SENSOR_ARBOL_LEVAS", name: "Sensor de árbol de levas", category: "Sensores", synonyms: ["sensor arbol de levas", "sensor de fase", "sensor posicion arbol levas"], specs: [S.connector] },
  { code: "SENSOR_CIGUENAL", name: "Sensor de cigüeñal", category: "Sensores", synonyms: ["sensor cigueñal", "sensor de ciguenal", "sensor rpm", "captador de regimen"], specs: [S.connector] },
  { code: "SONDA_LAMBDA", name: "Sonda lambda", category: "Sensores", synonyms: ["sonda lambda", "sensor de oxigeno", "lambda"], specs: [S.connector, S.pins, S.length] },
];

export const PART_BY_CODE = new Map(PART_TYPES.map((p) => [p.code, p]));
