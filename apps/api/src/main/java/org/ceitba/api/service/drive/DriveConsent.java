package org.ceitba.api.service.drive;

// The consent a student gives when registering a folder. Bump VERSION when
// TEXT changes materially: registrations must send the current version.
public final class DriveConsent {

    public static final String VERSION = "2026-10";

    public static final String TEXT = """
        Al conectar esta carpeta autorizás al CEITBA a leer su contenido con una cuenta de servicio de \
        solo lectura, guardar una copia y publicar, en la sección Apuntes, los archivos a los que les \
        asignes una materia. Se publican solo los archivos de tu propiedad; los de otras personas quedan \
        a revisión del staff. Podés ocultar archivos, publicar como anónimo, desconectar la carpeta o \
        dejar de compartirla en cualquier momento: al hacerlo se despublica todo y se borran las copias. \
        No subas datos personales de terceros ni material cuya distribución no esté permitida.""";

    private DriveConsent() {}
}
