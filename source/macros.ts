import ObjectIdentifier from "./types/ObjectIdentifier";
import EmbeddedPDV from "./types/EmbeddedPDV";
import { TypeIdentifier } from "./types/TypeIdentifier";

export type COMPONENTS_OF<T> = T;
export type OPTIONAL<T> = T | undefined;
export type BOOLEAN = boolean;
export type INTEGER = number;
export type BIT_STRING = Int8Array;
export type OCTET_STRING = Uint8Array;
export type NULL = null;
export type OBJECT_IDENTIFIER = ObjectIdentifier;
export type ObjectDescriptor = string;
export type EXTERNAL = External;
export type REAL = number;
export type INSTANCE_OF = External;
export type ENUMERATED = number;
export type EMBEDDED_PDV = EmbeddedPDV;
export type UTF8String = string;
export type RELATIVE_OID = number[];
export type SEQUENCE<T> = T[];
export type SEQUENCE_OF<T> = T[];
export type SET<T> = Set<T>;
export type SET_OF<T> = Set<T>;
export type GraphicString = string;
export type NumericString = string;
export type VisibleString = string;
export type PrintableString = string;
export type ISO646String = string;
export type TeletexString = Uint8Array;
export type GeneralString = string;
export type T61String = Uint8Array;
export type UniversalString = string;
export type VideotexString = Uint8Array;
export type BMPString = string;
export type IA5String = string;
// export type CharacterString = CharacterString;
export type UTCTime = Date;
export type GeneralizedTime = Date;
export type DATE = Date;
export type TIME_OF_DAY = Date;
export type DATE_TIME = Date;
// DURATION
export type OID_IRI = string;
export type RELATIVE_OID_IRI = string;

export const TRUE = true;
export const FALSE = false;
export const TRUE_BIT = 1;
export const FALSE_BIT = 0;
export const PLUS_INFINITY = Infinity;
export const MINUS_INFINITY = -Infinity;
export const NOT_A_NUMBER = NaN;

export const TYPE_IDENTIFIER = TypeIdentifier;
// ABSTRACT_SYNTAX

export const itu_t = 0;
export const ccitt = 0;
export const itu_r = 0;
export const iso = 1;
export const joint_iso_itu_t = 2;
export const joint_iso_ccitt = 2;
