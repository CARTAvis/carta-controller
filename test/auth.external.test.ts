import {expect, test, vi} from "vitest";
import {populateUserMap} from "../src/auth/external";
import {logger} from "../src/util";

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

`;

vi.mock("fs", () => ({
    readFileSync: vi.fn(_file_name => {
        return userMapString;
    })
}));

const logWarn = vi.spyOn(logger, "warning").mockImplementation(vi.fn());
const logInfo = vi.spyOn(logger, "info").mockImplementation(vi.fn());

test("Parse user mapping table file", () => {
    const userMaps = new Map();
    const expectedMaps = new Map([
        [
            "test_issuer",
            new Map([
                ["alice", "aliceuser"],
                ["Bob", "bobuser"],
                ["carol", "caroluser"],
                ["emma", "emmauser"],
                ["Rosalind Franklin", "rfranklin"],
                ["jane", "janeuser"]
            ])
        ]
    ]);

    populateUserMap(userMaps, "test_issuer", "dummy path");

    expect(userMaps).toStrictEqual(expectedMaps);
    expect(logWarn).toHaveBeenNthCalledWith(1, "Ignoring malformed usermap line: badline");
    expect(logWarn).toHaveBeenNthCalledWith(2, "Ignoring malformed usermap line: badlinewithcomment");
    expect(logInfo).toHaveBeenNthCalledWith(1, "Updated usermap with 6 entries");
    logWarn.mockReset();
    logInfo.mockReset();
});
