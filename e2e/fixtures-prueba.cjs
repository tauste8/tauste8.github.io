// DATOS FICTICIOS solo para pruebas automáticas. No cargar en la base de datos real.
var OEM_CSV = `referencia_oem;marca_vehiculo;descripcion;tipo_pieza;modelo;generacion;anio_desde;anio_hasta;codigos_motor;combustible;posicion;verificada;spec_amperaje;sustituida_por
TEST-ALT-001;Volkswagen;Alternador 140A;ALTERNADOR;Golf;V;2003;2009;BXE|BKC;Diésel;;si;140;TEST-ALT-002
TEST-ALT-002;Volkswagen;Alternador 140A (sustituta);ALTERNADOR;Golf;V;2003;2009;BXE|BKC;Diésel;;si;140;
TEST-ALT-001;Volkswagen;Alternador 140A;ALTERNADOR;Touran;;2003;2010;BXE;Diésel;;si;140;TEST-ALT-002
TEST-ALT-900;Volkswagen;Alternador 90A gasolina;ALTERNADOR;Golf;V;2003;2009;BLR;Gasolina;;si;90;
TEST-MIR-L;Volkswagen;Retrovisor izquierdo eléctrico;RETROVISOR;Golf;V;2003;2009;;;izquierdo;si;;
TEST-MIR-R;Volkswagen;Retrovisor derecho eléctrico;RETROVISOR;Golf;V;2003;2009;;;derecho;si;;
fila-mala;;;;;;;;;;;;;
`;
var IAM_CSV = `referencia_oem;marca_iam;referencia_iam;descripcion;verificada;spec_amperaje
TEST-ALT-001;MarcaPruebaA;TA 100 200;Alternador equivalente;si;140
TEST-ALT-001;MarcaPruebaB;TB-555;Alternador equivalente;si;180
TEST-ALT-001;MarcaPruebaC;TC777;Alternador equivalente;no;140
`;
var NEW_CSV = `descripcion;referencia;marca;referencia_oem;precio;stock;ubicacion
Alternador 140A;TA100200;MarcaPruebaA;;189,90;4;Madrid
Alternador 180A;TB555;MarcaPruebaB;;150,00;2;Madrid
Alternador original;TEST-ALT-001;Volkswagen;TEST-ALT-001;420,00;1;Madrid
Bomba de agua;TBW-1;MarcaPruebaA;;55,00;10;Madrid
`;
var USED_CSV = `descripcion;referencia_oem;precio;vehiculo_marca;vehiculo_modelo;vehiculo_anio;vehiculo_codigo_motor;ubicacion
ALTERNADOR VW GOLF V 1.9 TDI;TEST-ALT-001;60;Volkswagen;Golf;2006;BXE;Sevilla
ALTERNADOR VW GOLF V;;45;Volkswagen;Golf;2007;BXE;Valencia
ALTERNADOR VW GOLF V GASOLINA;;40;Volkswagen;Golf;2005;BLR;Valencia
`;
module.exports={OEM_CSV,IAM_CSV,NEW_CSV,USED_CSV};
