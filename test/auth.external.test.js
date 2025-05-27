const external = require('../dist/auth/external');
const fs = require('fs')

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

`

jest.mock('fs', () => ({
    readFileSync: jest.fn((file_name) => {
        return userMapString;
    })
}))

const log = jest.spyOn(console, "log").mockImplementation(() => {});

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

    external.populateUserMap(userMaps, "test_issuer", "dummy path");
    
    expect(userMaps).toStrictEqual(expectedMaps);
    expect(log).toHaveBeenNthCalledWith(1, "Ignoring malformed usermap line: badline");
    expect(log).toHaveBeenNthCalledWith(2, "Updated usermap with 6 entries");
    log.mockReset();
});
