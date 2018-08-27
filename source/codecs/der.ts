import { ASN1Element } from "../asn1";
import * as errors from "../errors";
import { ASN1Construction, ASN1RealEncodingBase, ASN1RealEncodingScale, ASN1SpecialRealValue, ASN1TagClass, generalizedTimeRegex, nr3Regex, printableStringCharacters, utcTimeRegex } from "../values";
import { X690Element } from "../x690";

export
class DERElement extends X690Element {

    set boolean (value : boolean) {
        this.value = new Uint8Array(1);
        this.value[0] = (value ? 0xFF : 0x00);
    }

    get boolean () : boolean {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("BOOLEAN cannot be constructed.");
        if (this.value.length !== 1)
            throw new errors.ASN1SizeError("BOOLEAN not one byte");
        if ((this.value[0] !== 0x00) && (this.value[0] !== 0xFF))
            throw new errors.ASN1Error("BOOLEAN must be encoded as 0xFF or 0x00.");
        return (this.value[0] !== 0);
    }

    set bitString (value : boolean[]) {
        if (value.length === 0)
            this.value = new Uint8Array(0);
        let pre : number[] = [];
        pre.length = ((value.length >>> 3) + ((value.length % 8) ? 1 : 0)) + 1;
        for (let i = 0; i < value.length; i++) {
            if (value[i] === false) continue;
            pre[((i >>> 3) + 1)] |= (0b10000000 >>> (i % 8));
        }
        pre[0] = (8 - (value.length % 8));
        if (pre[0] === 8) pre[0] = 0;
        this.value = new Uint8Array(pre);
    }

    get bitString () : boolean[] {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("BIT STRING cannot be constructed.");
        if (this.value.length === 0)
            throw new errors.ASN1Error("ASN.1 BIT STRING cannot be encoded on zero bytes!");
        if (this.value.length === 1 && this.value[0] !== 0)
            throw new errors.ASN1Error("ASN.1 BIT STRING encoded with deceptive first byte!");
        if (this.value[0] > 7)
            throw new errors.ASN1Error("First byte of an ASN.1 BIT STRING must be <= 7!");

        let ret : boolean[] = [];
        for (let i = 1; i < this.value.length; i++) {
            ret = ret.concat([
                (this.value[i] & 0b10000000 ? true : false),
                (this.value[i] & 0b01000000 ? true : false),
                (this.value[i] & 0b00100000 ? true : false),
                (this.value[i] & 0b00010000 ? true : false),
                (this.value[i] & 0b00001000 ? true : false),
                (this.value[i] & 0b00000100 ? true : false),
                (this.value[i] & 0b00000010 ? true : false),
                (this.value[i] & 0b00000001 ? true : false)
            ]);
        }
        ret.slice((ret.length - this.value[0])).forEach(bit => {
            if (bit) throw new errors.ASN1Error("BIT STRING had a trailing set bit.");
        });
        ret.length -= this.value[0];
        return ret;
    }

    set octetString (value : Uint8Array) {
        this.value = value.subarray(0); // Clones it.
    }

    get octetString () : Uint8Array {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("OCTET STRING cannot be constructed.");
        return this.value.subarray(0);
    }

    set objectDescriptor (value : string) {
        this.graphicString = value;
    }

    get objectDescriptor () : string {
        return this.graphicString;
    }

    // Only encodes with seven digits of precision.
    set real (value : number) {
        if (value === 0.0) {
            this.value = new Uint8Array(0); return;
        } else if (isNaN(value)) {
            this.value = new Uint8Array([ ASN1SpecialRealValue.notANumber ]); return;
        } else if (value === -0.0) {
            this.value = new Uint8Array([ ASN1SpecialRealValue.minusZero ]); return;
        } else if (value === Infinity) {
            this.value = new Uint8Array([ ASN1SpecialRealValue.plusInfinity ]); return;
        } else if (value === -Infinity) {
            this.value = new Uint8Array([ ASN1SpecialRealValue.minusInfinity ]); return;
        }
        let valueString : string = value.toFixed(7);
        valueString = (String.fromCharCode(0b00000011) + valueString); // Encodes as NR3
        this.value = (new TextEncoder()).encode(valueString);
    }

    get real () : number {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("REAL cannot be constructed.");
        if (this.value.length === 0) return 0.0;
        switch (this.value[0] & 0b11000000) {
            case (0b01000000): {
                if (this.value[0] === ASN1SpecialRealValue.notANumber) return NaN;
                if (this.value[0] === ASN1SpecialRealValue.minusZero) return -0.0;
                if (this.value[0] === ASN1SpecialRealValue.plusInfinity) return Infinity;
                if (this.value[0] === ASN1SpecialRealValue.minusInfinity) return -Infinity;
                throw new errors.ASN1UndefinedError("Unrecognized special REAL value!");
            }
            case (0b00000000): {
                let realString : string;
                if (typeof TextEncoder !== "undefined") { // Browser JavaScript
                    realString = (new TextDecoder("utf-8")).decode(this.value.slice(1));
                } else if (typeof Buffer !== "undefined") { // NodeJS
                    realString = (new Buffer(this.value.slice(1))).toString("utf-8");
                }
                switch (this.value[0] & 0b00111111) {
                    case 1: // NR1
                    case 2: // NR2
                        throw new errors.ASN1Error("DER prohibits NR1 and NR2 Base-10 REAL");
                    case 3: { // NR3
                        if (!nr3Regex.test(realString))
                            throw new errors.ASN1Error("Malformed NR3 Base-10 REAL");
                        return parseFloat(realString.replace(",", "."));
                    }
                    default:
                        throw new errors.ASN1UndefinedError("Undefined Base-10 REAL encoding.");
                }
            }
            case (0b10000000):
            case (0b11000000): {
                const sign : number = ((this.value[0] & 0b01000000) ? -1 : 1);

                const base : number = ((flag : number) => {
                    switch (flag) {
                        case (ASN1RealEncodingBase.base2):  return 2;
                        case (ASN1RealEncodingBase.base8):  return 8;
                        case (ASN1RealEncodingBase.base16): return 16;
                        default:
                            throw new errors.ASN1Error("Impossible REAL encoding base encountered.");
                    }
                })(this.value[0] & 0b00110000);

                const scale : number = ((flag : number) => {
                    switch (flag) {
                        case (ASN1RealEncodingScale.scale0): return 0;
                        case (ASN1RealEncodingScale.scale1): return 1;
                        case (ASN1RealEncodingScale.scale2): return 2;
                        case (ASN1RealEncodingScale.scale3): return 3;
                        default:
                            throw new errors.ASN1Error("Impossible REAL encoding scale encountered.");
                    }
                })(this.value[0] & 0b00001100);

                let exponent : number;
                let mantissa : number;
                switch (this.value[0] & 0b00000011) { // Exponent encoding
                    case (0b00000000): { // On the following octet
                        if (this.value.length < 3)
                            throw new errors.ASN1TruncationError("Binary-encoded REAL truncated.");
                        exponent = ASN1Element.decodeSignedBigEndianInteger(this.value.subarray(1, 2));
                        mantissa = ASN1Element.decodeUnsignedBigEndianInteger(this.value.subarray(2));
                        break;
                    }
                    case (0b00000001): { // On the following two octets
                        if (this.value.length < 4)
                            throw new errors.ASN1TruncationError("Binary-encoded REAL truncated.");
                        exponent = ASN1Element.decodeSignedBigEndianInteger(this.value.subarray(1, 3));
                        mantissa = ASN1Element.decodeUnsignedBigEndianInteger(this.value.subarray(3));
                        if (exponent <= 127 && exponent >= -128)
                            throw new errors.ASN1Error("DER-encoded binary-encoded REAL could have encoded exponent on fewer octets.");
                        break;
                    }
                    case (0b00000010):   // On the following three octets
                    case (0b00000011): { // Complicated.
                        throw new errors.ASN1Error("DER-encoded binary REAL encoded in a way that would either overflow or encode on too many octets.");
                    }
                    default:
                        throw new errors.ASN1Error("Impossible binary REAL exponent encoding encountered.");
                }

                if (mantissa !== 0 && !(mantissa % 2))
                    throw new errors.ASN1Error("DER-encoded REAL may not have an even non-zero mantissa.");

                return (sign * mantissa * Math.pow(2, scale) * Math.pow(base, exponent));
            }
        }
    }

    set utf8String (value : string) {
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(value);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(value, "utf-8");
        }
    }

    get utf8String () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("UTF8String cannot be constructed.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            ret = (new Buffer(this.value)).toString("utf-8");
        }
        return ret;
    }

    set sequence (value : DERElement[]) {
        let encodedElements : Uint8Array[] = [];
        value.forEach(element => {
            encodedElements.push(element.toBytes());
        });
        let totalLength : number = 0;
        encodedElements.forEach(element => {
            totalLength += element.length;
        });
        const newValue = new Uint8Array(totalLength);
        let currentIndex : number = 0;
        encodedElements.forEach(element => {
            newValue.set(element, currentIndex);
            currentIndex += element.length;
        });
        this.value = newValue;
        this.construction = ASN1Construction.constructed;
    }

    get sequence () : DERElement[] {
        if (this.construction !== ASN1Construction.constructed)
            throw new errors.ASN1ConstructionError("SET or SEQUENCE cannot be primitively constructed.");
        let encodedElements : DERElement[] = [];
        if (this.value.length === 0) return [];
        let i : number = 0;
        while (i < this.value.length) {
            const next : DERElement = new DERElement();
            i += next.fromBytes(this.value.slice(i));
            encodedElements.push(next);
        }
        return encodedElements;
    }

    set set (value : DERElement[]) {
        this.sequence = value;
    }

    get set () : DERElement[] {
        return this.sequence;
    }

    set numericString (value : string) {
        for (let i : number = 0; i < value.length; i++) {
            const characterCode : number = value.charCodeAt(i);
            if (!((characterCode >= 0x30 && characterCode <= 0x39) || characterCode === 0x20)) {
                throw new errors.ASN1CharactersError
                ("NumericString can only contain characters 0 - 9 and space.");
            }
        }

        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(value);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(value, "utf-8");
        }
    }

    get numericString () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("NumericString cannot be constructed.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            ret = (new Buffer(this.value)).toString("utf-8");
        }
        for (let i : number = 0; i < ret.length; i++) {
            const characterCode : number = ret.charCodeAt(i);
            if (!((characterCode >= 0x30 && characterCode <= 0x39) || characterCode === 0x20)) {
                throw new errors.ASN1CharactersError
                ("NumericString can only contain characters 0 - 9 and space.");
            }
        }
        return ret;
    }

    set printableString (value : string) {
        for (let i : number = 0; i < value.length; i++) {
            if (printableStringCharacters.indexOf(value.charAt(i)) === -1) {
                throw new errors.ASN1CharactersError
                (`PrintableString can only contain these characters: ${printableStringCharacters}`);
            }
        }

        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(value);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(value, "utf-8");
        }
    }

    get printableString () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("PrintableString cannot be constructed.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer); // REVIEW: Is the subarray(0) necessary?
        } else if (typeof Buffer !== "undefined") { // NodeJS
            ret = (new Buffer(this.value)).toString("utf-8");
        }
        for (let i : number = 0; i < ret.length; i++) {
            if (printableStringCharacters.indexOf(ret.charAt(i)) === -1) {
                throw new errors.ASN1CharactersError
                (`PrintableString can only contain these characters: ${printableStringCharacters}`);
            }
        }
        return ret;
    }

    set teletexString (value : Uint8Array) {
        this.value = value.subarray(0); // Clones it.
    }

    get teletexString () : Uint8Array {
        return this.octetString;
    }

    set videotexString (value : Uint8Array) {
        this.value = value.subarray(0); // Clones it.
    }

    get videotexString () : Uint8Array {
        return this.octetString;
    }

    set ia5String (value : string) {
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(value);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(value, "utf-8");
        }
    }

    get ia5String () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("IA5String cannot be constructed.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            ret = (new Buffer(this.value)).toString("utf-8");
        }
        return ret;
    }

    set utcTime (value : Date) {
        let year : string = value.getUTCFullYear().toString();
        year = (year.substring(year.length - 2, year.length)); // Will fail if you supply a <2 digit date.
        const month : string = (value.getUTCMonth() < 9 ? `0${value.getUTCMonth() + 1}` : `${value.getUTCMonth() + 1}`);
        const day : string = (value.getUTCDate() < 10 ? `0${value.getUTCDate()}` : `${value.getUTCDate()}`);
        const hour : string = (value.getUTCHours() < 10 ? `0${value.getUTCHours()}` : `${value.getUTCHours()}`);
        const minute : string = (value.getUTCMinutes() < 10 ? `0${value.getUTCMinutes()}` : `${value.getUTCMinutes()}`);
        const second : string = (value.getUTCSeconds() < 10 ? `0${value.getUTCSeconds()}` : `${value.getUTCSeconds()}`);
        const utcString = `${year}${month}${day}${hour}${minute}${second}Z`;
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(utcString);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(utcString, "utf-8");
        }
    }

    get utcTime () : Date {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("UTCTime cannot be constructed.");
        let dateString : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            dateString = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            dateString = (new Buffer(this.value)).toString("utf-8");
        }
        const match : RegExpExecArray = utcTimeRegex.exec(dateString);
        if (match === null) throw new errors.ASN1Error("Malformed UTCTime string.");
        const ret : Date = new Date();
        let year : number = Number(match.groups.year);
        year = (year < 70 ? (2000 + year) : (1900 + year));
        const month : number = (Number(match.groups.month) - 1);
        const date : number = Number(match.groups.date);
        const hours : number = Number(match.groups.hour);
        const minutes : number = Number(match.groups.minute);
        const seconds : number = Number(match.groups.second);
        DERElement.validateDateTime("UTCTime", year, month, date, hours, minutes, seconds);
        ret.setUTCFullYear(year);
        ret.setUTCMonth(month);
        ret.setUTCDate(date);
        ret.setUTCHours(hours);
        ret.setUTCMinutes(minutes);
        ret.setUTCSeconds(seconds);
        return ret;
    }

    set generalizedTime (value : Date) {
        const year : string = value.getUTCFullYear().toString();
        const month : string = (value.getUTCMonth() < 9 ? `0${value.getUTCMonth() + 1}` : `${value.getUTCMonth() + 1}`);
        const day : string = (value.getUTCDate() < 10 ? `0${value.getUTCDate()}` : `${value.getUTCDate()}`);
        const hour : string = (value.getUTCHours() < 10 ? `0${value.getUTCHours()}` : `${value.getUTCHours()}`);
        const minute : string = (value.getUTCMinutes() < 10 ? `0${value.getUTCMinutes()}` : `${value.getUTCMinutes()}`);
        const second : string = (value.getUTCSeconds() < 10 ? `0${value.getUTCSeconds()}` : `${value.getUTCSeconds()}`);
        const timeString = `${year}${month}${day}${hour}${minute}${second}Z`;
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(timeString);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(timeString, "utf-8");
        }
    }

    get generalizedTime () : Date {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("GeneralizedTime cannot be constructed.");
        let dateString : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            dateString = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            dateString = (new Buffer(this.value)).toString("utf-8");
        }
        const match : RegExpExecArray = generalizedTimeRegex.exec(dateString);
        if (match === null) throw new errors.ASN1Error("Malformed GeneralizedTime string.");
        const ret : Date = new Date();
        const year : number = Number(match.groups.year);
        const month : number = (Number(match.groups.month) - 1);
        const date : number = Number(match.groups.date);
        const hours : number = Number(match.groups.hour);
        const minutes : number = Number(match.groups.minute);
        const seconds : number = Number(match.groups.second);
        DERElement.validateDateTime("GeneralizedTime", year, month, date, hours, minutes, seconds);
        ret.setUTCFullYear(year);
        ret.setUTCMonth(month);
        ret.setUTCDate(date);
        ret.setUTCHours(hours);
        ret.setUTCMinutes(minutes);
        ret.setUTCSeconds(seconds);
        return ret;
    }

    set graphicString (value : string) {
        for (let i : number = 0; i < value.length; i++) {
            const characterCode : number = value.charCodeAt(i);
            if (characterCode < 0x20 || characterCode > 0x7E)
                throw new errors.ASN1CharactersError
                (
                    "GraphicString, VisibleString, or ObjectDescriptor " +
                    "can only contain characters between 0x20 and 0x7E."
                );
        }

        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(value);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(value, "utf-8");
        }
    }

    get graphicString () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("GraphicString cannot be constructed.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("utf-8")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            ret = (new Buffer(this.value)).toString("utf-8");
        }
        for (let i : number = 0; i < ret.length; i++) {
            const characterCode : number = ret.charCodeAt(i);
            if (characterCode < 0x20 || characterCode > 0x7E) {
                throw new errors.ASN1CharactersError
                (
                    "GraphicString, VisibleString, or ObjectDescriptor " +
                    "can only contain characters between 0x20 and 0x7E."
                );
            }
        }
        return ret;
    }

    set visibleString (value : string) {
        this.graphicString = value;
    }

    get visibleString () : string {
        return this.graphicString;
    }

    set generalString (value : string) {
        for (let i : number = 0; i < value.length; i++) {
            if (value.charCodeAt(i) > 0x7F)
                throw new errors.ASN1CharactersError
                ("GeneralString can only contain ASCII characters.");
        }
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            this.value = (new TextEncoder()).encode(value);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            this.value = Buffer.from(value, "ascii");
        }
    }

    get generalString () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("GeneralString cannot be constructed.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("windows-1252")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            ret = (new Buffer(this.value)).toString("ascii");
        }
        for (let i : number = 0; i < ret.length; i++) {
            if (ret.charCodeAt(i) > 0x7F)
                throw new errors.ASN1CharactersError
                ("GeneralString can only contain ASCII characters.");
        }
        return ret;
    }

    set universalString (value : string) {
        const buf : Uint8Array = new Uint8Array(value.length << 2);
        for (let i : number = 0; i < value.length; i++) {
            buf[(i << 2)]      = value.charCodeAt(i) >>> 24;
            buf[(i << 2) + 1]  = value.charCodeAt(i) >>> 16;
            buf[(i << 2) + 2]  = value.charCodeAt(i) >>> 8;
            buf[(i << 2) + 3]  = value.charCodeAt(i);
        }
        this.value = buf;
    }

    /** NOTE:
     * This might not decode anything above 0xFFFF, because JavaScript
     * natively uses either UCS-2 or UTF-16. If it uses UTF-16 (which
     * most do), it might work, but UCS-2 will definitely not work.
     */
    get universalString () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("UniversalString cannot be constructed.");
        if (this.value.length % 4)
            throw new errors.ASN1Error
            ("UniversalString encoded on non-mulitple of four bytes.");
        let ret : string = "";
        for (let i : number = 0; i < this.value.length; i += 4) {
            ret += String.fromCharCode(
                (this.value[i + 0] << 24) +
                (this.value[i + 1] << 16) +
                (this.value[i + 2] << 8)  +
                (this.value[i + 3] << 0)
            );
        }
        return ret;
    }

    set bmpString (value : string) {
        const buf : Uint8Array = new Uint8Array(value.length << 1);
        for (let i : number = 0, strLen : number = value.length; i < strLen; i++) {
            buf[(i << 1)]      = value.charCodeAt(i) >>> 8;
            buf[(i << 1) + 1]  = value.charCodeAt(i);
        }
        this.value = buf;
    }

    get bmpString () : string {
        if (this.construction !== ASN1Construction.primitive)
            throw new errors.ASN1ConstructionError("BMPString cannot be constructed.");
        if (this.value.length % 2)
            throw new errors.ASN1Error
            ("BMPString encoded on non-mulitple of two bytes.");
        let ret : string = "";
        if (typeof TextEncoder !== "undefined") { // Browser JavaScript
            ret = (new TextDecoder("utf-16be")).decode(<ArrayBuffer>this.value.subarray(0).buffer);
        } else if (typeof Buffer !== "undefined") { // NodeJS
            const swappedEndianness : Uint8Array = new Uint8Array(this.value.length);
            for (let i : number = 0; i < this.value.length; i += 2) {
                swappedEndianness[i] = this.value[i + 1];
                swappedEndianness[i + 1] = this.value[i];
            }
            /** REVIEW:
             * Since NodeJS does not have a UTF-16-BE decoder, can we swap
             * every pair of bytes to make it little-endian, then decode
             * using NodeJS's utf-16-le decoder?
             */
            ret = (new Buffer(swappedEndianness)).toString("utf-16le");
        }
        return ret;
    }

    constructor
    (
        tagClass : ASN1TagClass = ASN1TagClass.universal,
        construction : ASN1Construction = ASN1Construction.primitive,
        tagNumber : number = 0
    )
    {
        super();
        this.tagClass = tagClass;
        this.construction = construction;
        this.tagNumber = tagNumber;
        this.value = new Uint8Array(0);
    }

    // Returns the number of bytes read
    public fromBytes (bytes : Uint8Array) : number {
        if (bytes.length < 2)
            throw new errors.ASN1TruncationError
            ("Tried to decode a DER element that is less than two bytes.");
        if ((this.recursionCount + 1) > DERElement.nestingRecursionLimit)
            throw new errors.ASN1RecursionError();
        let cursor : number = 0;
        switch (bytes[cursor] & 0b11000000) {
            case (0b00000000): this.tagClass = ASN1TagClass.universal; break;
            case (0b01000000): this.tagClass = ASN1TagClass.application; break;
            case (0b10000000): this.tagClass = ASN1TagClass.context; break;
            case (0b11000000): this.tagClass = ASN1TagClass.private; break;
            default: this.tagClass = ASN1TagClass.universal;
        }
        this.construction = ((bytes[cursor] & 0b00100000) ?
            ASN1Construction.constructed : ASN1Construction.primitive);
        this.tagNumber = (bytes[cursor] & 0b00011111);
        cursor++;
        if (this.tagNumber >= 31) {
            /* NOTE:
                Section 8.1.2.4.2, point C of the International
                Telecommunications Union's X.690 specification says:
                "bits 7 to 1 of the first subsequent octet shall not all be zero."
                in reference to the bytes used to encode the tag number in long
                form, which happens when the least significant five bits of the
                first byte are all set.
                This essentially means that the long-form tag number must be
                encoded on the fewest possible octets. If the first byte is
                0b10000000, then it is not encoded on the fewest possible octets.
            */
            if (bytes[cursor] === 0b10000000)
                throw new errors.ASN1PaddingError
                ("Leading padding byte on long tag number encoding.");
            this.tagNumber = 0;
            // This loop looks for the end of the encoded tag number.
            const limit : number = (((bytes.length - 1) >= 4) ? 4 : (bytes.length - 1));
            while (cursor < limit) {
                if (!(bytes[cursor++] & 0b10000000)) break;
            }
            if (bytes[cursor-1] & 0b10000000) {
                if (limit === bytes.length-1) {
                    throw new errors.ASN1TruncationError
                    ("ASN.1 tag number appears to have been truncated.");
                } else
                    throw new errors.ASN1OverflowError("ASN.1 tag number too large.");
            }
            for (let i : number = 1; i < cursor; i++) {
                this.tagNumber <<= 7;
                this.tagNumber |= (bytes[i] & 0x7F);
            }
            if (this.tagNumber <= 31)
                throw new errors.ASN1Error("ASN.1 tag number could have been encoded in short form.");
        }

        // Length
        if ((bytes[cursor] & 0b10000000) === 0b10000000) {
            const numberOfLengthOctets : number = (bytes[cursor] & 0x7F);
            if (numberOfLengthOctets === 0b01111111) // Reserved
                throw new errors.ASN1UndefinedError
                ("Length byte with undefined meaning encountered.");
            // Definite Long, if it has made it this far
            if (numberOfLengthOctets > 4)
                throw new errors.ASN1OverflowError
                ("Element length too long to decode to an integer.");
            if (cursor + numberOfLengthOctets >= bytes.length)
                throw new errors.ASN1TruncationError
                ("Element length bytes appear to have been truncated.");
            cursor++;
            const lengthNumberOctets : Uint8Array = new Uint8Array(4);
            for (let i : number = numberOfLengthOctets; i > 0; i--) {
                lengthNumberOctets[(4 - i)] = bytes[(cursor + numberOfLengthOctets - i)];
            }
            let length : number = 0;
            lengthNumberOctets.forEach(octet => {
                length <<= 8;
                length += octet;
            });
            if ((cursor + length) < cursor) // This catches an overflow.
                throw new errors.ASN1OverflowError("ASN.1 element too large.");
            cursor += (numberOfLengthOctets);
            if ((cursor + length) > bytes.length)
                throw new errors.ASN1TruncationError("ASN.1 element truncated.");
            this.value = bytes.slice(cursor, (cursor + length));
            return (cursor + length);
        } else { // Definite Short
            const length : number = (bytes[cursor++] & 0x7F);
            if ((cursor + length) > bytes.length)
                throw new errors.ASN1TruncationError("ASN.1 element was truncated.");
            this.value = bytes.slice(cursor, (cursor + length));
            return (cursor + length);
        }
    }

    public toBytes () : Uint8Array {
        let tagBytes : number[] = [ 0x00 ];
        tagBytes[0] |= this.tagClass;
        tagBytes[0] |= this.construction;
        if (this.tagNumber < 31) {
            tagBytes[0] |= this.tagNumber;
        } else {
            /*
                Per section 8.1.2.4 of X.690:
                The last five bits of the first byte being set indicate that
                the tag number is encoded in base-128 on the subsequent octets,
                using the first bit of each subsequent octet to indicate if the
                encoding continues on the next octet, just like how the
                individual numbers of OBJECT IDENTIFIER and RELATIVE OBJECT
                IDENTIFIER are encoded.
            */
            tagBytes[0] |= 0b00011111;
            let number : number = this.tagNumber; // We do not want to modify by reference.
            let encodedNumber : number[] = [];
            while (number !== 0) {
                encodedNumber.unshift(number & 0x7F);
                number >>>= 7;
                encodedNumber[0] |= 0b10000000;
            }
            encodedNumber[encodedNumber.length - 1] &= 0b01111111;
            tagBytes = tagBytes.concat(encodedNumber);
        }

        let lengthOctets : number[] = [ 0x00 ];
        if (this.value.length < 127) {
            lengthOctets = [ this.value.length ];
        } else {
            let length : number = this.value.length;
            lengthOctets = [ 0, 0, 0, 0 ];
            for (let i : number = 0; i < 4; i++) {
                lengthOctets[i] = ((length >>> ((3 - i) << 3)) & 0xFF);
            }
            let startOfNonPadding : number = 0;
            for (let i : number = 0; i < (lengthOctets.length - 1); i++) {
                if (lengthOctets[i] === 0x00) startOfNonPadding++;
            }
            lengthOctets = lengthOctets.slice(startOfNonPadding);
            lengthOctets.unshift(0b10000000 | lengthOctets.length);
        }

        const ret : Uint8Array = new Uint8Array(
            tagBytes.length +
            lengthOctets.length +
            this.value.length
        );
        ret.set(tagBytes, 0);
        ret.set(lengthOctets, tagBytes.length);
        ret.set(this.value, (tagBytes.length + lengthOctets.length));
        return ret;
    }
}