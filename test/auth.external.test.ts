import * as fs from "fs";
import {expect, test, vi} from 'vitest';
import {populateUserMap} from "../src/auth/external";
import { logger } from '../src/util';
import winston from 'winston';

const userMapString = `
   # foo
# bar
alice aliceuser
Bob    bobuser
carol\tcaroluser
emma emmauser\r
Rosalind Franklin   rfranklin
jane  janeuser # comment about Jane
badline
badlinewithcomment # comment

`

vi.mock('fs', () => ({
    readFileSync: vi.fn((file_name) => {
        return userMapString;
    })
}))

if (logger.transports.length == 0)
    logger.add(new winston.transports.Console({silent: true}))
if (!logger.warn) {
    logger.warn = vi.fn();
}
if (!logger.info) {
    logger.info = vi.fn();
}
const logWarn = vi.spyOn(logger, "warn");
const logInfo = vi.spyOn(logger, "info");

test('Parse user mapping table file', () => {
    const userMaps = new Map();
    const expectedMaps = new Map([
        ["test_issuer", new Map([
            ["alice", "aliceuser"],
            ["Bob", "bobuser"],
            ["carol", "caroluser"],
            ["emma", "emmauser"],
            ["Rosalind Franklin", "rfranklin"],
            ["jane", "janeuser"]
        ])]
    ]);

    populateUserMap(userMaps, "test_issuer", "dummy path");
    
    expect(userMaps).toStrictEqual(expectedMaps);
    expect(logWarn).toHaveBeenNthCalledWith(1, "Ignoring malformed usermap line: badline");
    expect(logWarn).toHaveBeenNthCalledWith(2, "Ignoring malformed usermap line: badlinewithcomment");
    expect(logInfo).toHaveBeenNthCalledWith(1, "Updated usermap with 6 entries");
    logWarn.mockReset();
    logInfo.mockReset();
});
