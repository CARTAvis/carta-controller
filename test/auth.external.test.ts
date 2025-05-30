import * as fs from "fs";
import {expect, test, vi} from 'vitest';
import {populateUserMap} from "../src/auth/external";

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

const log = vi.spyOn(console, "log").mockImplementation(() => {});

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
    expect(log).toHaveBeenNthCalledWith(1, "Ignoring malformed usermap line: badline");
    expect(log).toHaveBeenNthCalledWith(2, "Ignoring malformed usermap line: badlinewithcomment");
    expect(log).toHaveBeenNthCalledWith(3, "Updated usermap with 6 entries");
    log.mockReset();
});
