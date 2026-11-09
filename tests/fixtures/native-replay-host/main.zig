const std = @import("std");
const craft = @import("craft");

pub fn main() !void {
    var heap: std.heap.DebugAllocator(.{}) = .init;
    defer std.debug.assert(heap.deinit() == .ok);
    const allocator = heap.allocator();
    var runtime = try craft.js_runtime.PersistentRuntime.init(allocator, .{});
    defer runtime.deinit() catch unreachable;
    const frame = runtime.evaluate(@embedFile("probe.js")) catch |err| {
        std.debug.print("bundle load failed before first callback: {s}\n", .{@errorName(err)});
        return err;
    };
    defer runtime.release(frame) catch unreachable;
    for (0..10003) |index| {
        const value = runtime.call(frame, null, &.{}) catch |err| {
            std.debug.print("retained callback {d} failed: {s}\n", .{ index, @errorName(err) });
            return err;
        };
        defer runtime.release(value) catch unreachable;
        if (try runtime.kind(value) == .string) {
            const result = try runtime.copyString(value, allocator);
            defer allocator.free(result);
            std.debug.print("{{\"callbacks\":{d},\"result\":{s}}}\n", .{ index + 1, result });
            return;
        }
        _ = try runtime.number(value);
    }
    return error.IncompleteScenario;
}
