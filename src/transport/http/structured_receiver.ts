import { CloudEvent, Version } from "../..";
import { Headers, sanitize } from "./headers";
import { Parser, JSONParser, MappedParser, Base64Parser } from "../../parsers";
import { parserByContentType } from "../../parsers";
import { v1structuredParsers, v03structuredParsers } from "./versions";
import { isString, isBase64, ValidationError, isStringOrObjectOrThrow } from "../../event/validation";
import { CloudEventV1, CloudEventV03 } from "../../event/interfaces";
import { validateCloudEvent } from "../../event/spec";
import CONSTANTS from "../../constants";

/**
 * A utility class used to receive structured CloudEvents
 * over HTTP.
 * @see {StructuredReceiver}
 */
export class StructuredHTTPReceiver {
  /**
   * The specification version of the incoming cloud event
   */
  version: Version;
  constructor(version: Version = Version.V1) {
    this.version = version;
  }

  /**
   * Creates a new CloudEvent instance based on the provided payload and headers.
   *
   * @param {object} payload the cloud event data payload
   * @param {object} headers  the HTTP headers received for this cloud event
   * @returns {CloudEvent} a new CloudEvent instance for the provided headers and payload
   * @throws {ValidationError} if the payload and header combination do not conform to the spec
   */
  parse(payload: Record<string, unknown> | string | undefined | null, headers: Headers): CloudEvent {
    if (!payload) throw new ValidationError("payload is null or undefined");
    if (!headers) throw new ValidationError("headers is null or undefined");
    isStringOrObjectOrThrow(payload, new ValidationError("payload must be an object or a string"));

    if (
      headers[CONSTANTS.CE_HEADERS.SPEC_VERSION] &&
      headers[CONSTANTS.CE_HEADERS.SPEC_VERSION] != Version.V03 &&
      headers[CONSTANTS.CE_HEADERS.SPEC_VERSION] != Version.V1
    ) {
      throw new ValidationError(`invalid spec version ${headers[CONSTANTS.CE_HEADERS.SPEC_VERSION]}`);
    }

    payload = isString(payload) && isBase64(payload) ? Buffer.from(payload as string, "base64").toString() : payload;

    // Clone and low case all headers names
    const sanitizedHeaders = sanitize(headers);

    const contentType = sanitizedHeaders[CONSTANTS.HEADER_CONTENT_TYPE];
    const parser: Parser = contentType ? parserByContentType[contentType] : new JSONParser();
    if (!parser) throw new ValidationError(`invalid content type ${sanitizedHeaders[CONSTANTS.HEADER_CONTENT_TYPE]}`);
    const incoming = { ...(parser.parse(payload) as Record<string, unknown>) };

    const eventObj: { [key: string]: unknown } = {};
    const parserMap: Record<string, MappedParser> =
      this.version === Version.V1 ? v1structuredParsers : v03structuredParsers;

    for (const key in parserMap) {
      const property = incoming[key];
      if (property) {
        const parser: MappedParser = parserMap[key];
        eventObj[parser.name] = parser.parser.parse(property as string);
      }
      delete incoming[key];
    }

    // extensions are what we have left after processing all other properties
    for (const key in incoming) {
      eventObj[key] = incoming[key];
    }

    // ensure data content is correctly encoded
    if (eventObj.data && eventObj.datacontentencoding) {
      if (eventObj.datacontentencoding === CONSTANTS.ENCODING_BASE64 && !isBase64(eventObj.data)) {
        throw new ValidationError("invalid payload");
      } else if (eventObj.datacontentencoding === CONSTANTS.ENCODING_BASE64) {
        const dataParser = new Base64Parser();
        eventObj.data = JSON.parse(dataParser.parse(eventObj.data as string));
        delete eventObj.datacontentencoding;
      }
    }

    const cloudevent = new CloudEvent(eventObj as CloudEventV1 | CloudEventV03);

    // Validates the event
    validateCloudEvent(cloudevent);
    return cloudevent;
  }
}
